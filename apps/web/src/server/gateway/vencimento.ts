// Helper compartilhado da data de vencimento — usado tanto no payload do gateway (payment_terms)
// quanto na persistência de `boletos.vencimento`, garantindo a MESMA data (coerência, Story 4.2).
import type { CondicoesEmissao } from '@cobranca/shared';

/**
 * Data de vencimento, no formato AAAA-MM-DD:
 *   - `modoVencimento === 'dias_corridos'` (padrão): hoje + `diasVencimento`.
 *   - `modoVencimento === 'dia_fixo'` (Epic 11 — clientes de contabilidade com vencimento fixo,
 *     ex.: dia 10, dia 12): próxima ocorrência de `diaFixoVencimento` no calendário.
 */
export function calcularVencimento(
  condicoes: Pick<CondicoesEmissao, 'diasVencimento' | 'modoVencimento' | 'diaFixoVencimento'>,
): string {
  if (condicoes.modoVencimento === 'dia_fixo' && condicoes.diaFixoVencimento) {
    return calcularProximoDiaFixo(condicoes.diaFixoVencimento);
  }
  const d = new Date();
  d.setDate(d.getDate() + condicoes.diasVencimento);
  return d.toISOString().slice(0, 10);
}

/**
 * Próxima ocorrência do dia fixo do mês: se ainda não chegou no mês corrente, usa o mês
 * corrente; senão, o próximo. Meses mais curtos que `diaFixo` (ex.: dia 31 em fevereiro) usam
 * o último dia daquele mês, nunca "vazam" para o mês seguinte.
 */
function calcularProximoDiaFixo(diaFixo: number): string {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const diaNesteMes = ultimoDiaValido(ano, mes, diaFixo);
  const alvo =
    hoje.getDate() < diaNesteMes
      ? new Date(ano, mes, diaNesteMes)
      : new Date(ano, mes + 1, ultimoDiaValido(ano, mes + 1, diaFixo));
  return alvo.toISOString().slice(0, 10);
}

/** Dia efetivo dentro do mês (`ano`/`mes` 0-based), limitado ao último dia real do mês. */
function ultimoDiaValido(ano: number, mes: number, dia: number): number {
  const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate();
  return Math.min(dia, ultimoDiaDoMes);
}
