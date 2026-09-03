// POST /api/execucoes/guias-manuais — lê a planilha de guias CONFERIDAS MANUALMENTE (migration
// 0058) e devolve o PREVIEW resolvido contra o cadastro: quais médicos casaram por CPF, com que
// total/motivo, e quais linhas deram erro. NÃO grava nada e NÃO dispara execução: o número só
// vira dado quando o operador confirma o disparo em POST /api/execucoes (o preview existe
// justamente para ele conferir antes — é dinheiro real).
//
// Formato esperado: ver /templates/guias-manuais-modelo.csv (download na tela de nova emissão).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarMedicos } from '@/server/repositories/medico-repository';
import { resolverGuiasManuais } from '@/server/csv/guias-manuais-import';
import { extrairLinhasDoArquivo } from '@/server/csv/planilha-import';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import type { GuiasManuaisPreview } from '@/services/execucoes';

// Mesmos limites anti-DoS dos demais imports (o arquivo é lido inteiro em memória). A planilha
// real tem uma linha por médico com divergência — dezenas, não milhares.
const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CSV_ROWS = 5000;

const previewLimiter = createRateLimiter('execucoes-guias-manuais', { limit: 10, windowMs: 60_000 });

export const POST = withErrorHandler(async (req) => {
  // Mesmos papéis que podem disparar execução (POST /api/execucoes) — quem não pode emitir não
  // tem por que preparar a planilha que muda o valor cobrado.
  const sessao = await requireRole(['admin', 'colaborador']);
  assertRateLimit(previewLimiter, sessao.userId, 'leitura da planilha de guias manuais');

  const formData = await req.formData();
  const competencia = String(formData.get('competencia') ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    throw new ApiError(422, 'Competência inválida (AAAA-MM)', 'COMPETENCIA_INVALIDA');
  }

  const rows = await extrairLinhasDoArquivo(formData, { maxBytes: MAX_CSV_BYTES, maxRows: MAX_CSV_ROWS });

  // Uma query só para o cruzamento por CPF (em vez de uma busca por linha) — o repositório não
  // tem (nem precisa de) busca por CPF. Traz TODOS, inclusive inativos/pendentes: assim
  // `resolverGuiasManuais` distingue "CPF não existe no cadastro" de "existe mas está fora da
  // emissão", que são dois problemas com correções bem diferentes para o operador.
  const medicos = await listarMedicos();

  return Response.json(resolverGuiasManuais(rows, medicos, competencia) satisfies GuiasManuaisPreview);
});
