// GET /api/contas/saldo — saldo das contas emissoras para os cards do dashboard
// (Story 8.3, D5 da arquitetura). Cache em memória de 60s POR CONTA: o dashboard não pode
// disparar a cadeia mTLS a cada render (mesma técnica do cache de token do CoraHttpClient).
//
// Degradação por conta — esta rota NUNCA devolve erro HTTP por conta quebrada:
//   - conta sem credenciais (CV pré-ativação) → { configurada: false } → card "não configurada";
//   - consulta falhou (Cora fora) → { configurada: true, saldo: null, erro } → "indisponível";
//   - as demais contas não são afetadas.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarContaGateway } from '@/server/gateway/conta-gateway-factory';
import { CONTAS_EMISSORAS_VALIDAS, CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import type { ContaEmissora, SaldoEmpresa } from '@cobranca/shared';

// Route files só podem exportar handlers/config no App Router — nada de helper exportado
// para limpar o cache; testes que precisarem disso usam vi.resetModules().
const CACHE_TTL_MS = 60_000;
const cache = new Map<ContaEmissora, { em: number; resposta: SaldoEmpresa }>();

async function saldoDaConta(conta: ContaEmissora): Promise<SaldoEmpresa> {
  const hit = cache.get(conta);
  if (hit && Date.now() - hit.em < CACHE_TTL_MS) return hit.resposta;

  let resposta: SaldoEmpresa;
  try {
    const gateway = criarContaGateway(conta);
    const r = await gateway.consultarSaldo();
    resposta = r.sucesso
      ? { conta, nome: CONTA_EMISSORA_LABEL[conta], configurada: true, saldo: r.saldo }
      : { conta, nome: CONTA_EMISSORA_LABEL[conta], configurada: true, saldo: null, erro: r.erro };
  } catch {
    // Factory lançou = credenciais ausentes — estado esperado da CV até o Cora Pro.
    resposta = { conta, nome: CONTA_EMISSORA_LABEL[conta], configurada: false, saldo: null };
  }
  cache.set(conta, { em: Date.now(), resposta });
  return resposta;
}

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'financeiro']);
  const saldos = await Promise.all(CONTAS_EMISSORAS_VALIDAS.map(saldoDaConta));
  return Response.json(saldos);
});
