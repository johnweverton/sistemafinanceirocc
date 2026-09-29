// POST /api/clientes-contabilidade/faturamentos/iss-teste-nuvem — SPIKE (Épico 13): o portal do
// ISS Fortaleza aceita ser lido a partir da Vercel (região São Paulo), sem o computador do
// escritório? Lê UMA empresa numa competência, reaproveitando o driver do agente local
// (apps/agente-iss/src/portal) com o Chromium serverless, e devolve o passo a passo.
//
//   POST { documento: "63510691000193", competencia: "2026-08" }
//
// Só admin. Senha em ISS_CPF / ISS_SENHA (variáveis da Vercel), nunca devolvida nem logada.
// UM login por chamada — não chame em sequência se o login for recusado (bloqueia o MASTER).
// Não grava nada no banco: é só para medir viabilidade antes de migrar o agente para a nuvem.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { PortalIss, type Diagnostico } from '@cobranca/agente-iss/src/portal/portal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const preferredRegion = 'gru1';
export const maxDuration = 300;

const corpoSchema = z.object({
  documento: z.string().regex(/^\d{11}$|^\d{14}$/, 'CPF (11) ou CNPJ (14 dígitos), só números'),
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM'),
});

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const cpf = process.env.ISS_CPF;
  const senha = process.env.ISS_SENHA;
  if (!cpf || !senha) {
    throw new ApiError(500, 'ISS_CPF e/ou ISS_SENHA não configurados na Vercel', 'CONFIG');
  }

  const inicio = Date.now();
  const passos: string[] = [];
  const log = (msg: string) => passos.push(`[${((Date.now() - inicio) / 1000).toFixed(1)}s] ${msg}`);
  const diag: Diagnostico = { log, reconhecer: false, snapshot: async () => null };

  const [{ default: chromiumServerless }, { chromium }] = await Promise.all([
    import('@sparticuz/chromium'),
    import('playwright-core'),
  ]);
  log('Abrindo o Chromium…');
  const browser = await chromium.launch({
    executablePath: await chromiumServerless.executablePath(),
    args: chromiumServerless.args,
    headless: true,
  });
  const context = await browser.newContext({ locale: 'pt-BR', acceptDownloads: false, viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    // O driver foi tipado com o `Page` do pacote `playwright`; é a mesma classe do playwright-core.
    const portal = new PortalIss(page as unknown as ConstructorParameters<typeof PortalIss>[0], diag);
    await portal.login(cpf, senha);
    const empresa = await portal.selecionarEmpresa(parsed.data.documento);
    log(`Empresa selecionada: ${empresa.razaoSocial} (inscrição ${empresa.inscricao})`);
    const leitura = await portal.lerCompetencia(parsed.data.competencia);
    log(`Leitura: ${JSON.stringify(leitura)}`);
    return Response.json({ ok: true, empresa, leitura, segundos: (Date.now() - inicio) / 1000, passos });
  } catch (e) {
    // Onde parou é o que interessa num spike: URL, título e o começo do texto da tela (sem o CPF).
    const texto = (await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')).replaceAll(cpf, '***');
    return Response.json(
      {
        ok: false,
        erro: e instanceof Error ? `${e.name}: ${e.message}`.replaceAll(cpf, '***') : String(e),
        url: page.url(),
        titulo: await page.title().catch(() => ''),
        tela: texto.slice(0, 1500),
        segundos: (Date.now() - inicio) / 1000,
        passos,
      },
      { status: 502 },
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
});
