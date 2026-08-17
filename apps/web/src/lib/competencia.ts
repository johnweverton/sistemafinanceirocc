// Aritmética de competência (AAAA-MM) — função pura, sem passar por Date pra evitar
// deslocamento de fuso horário (mesmo cuidado de formatarDataBR em mensagem-boleto.ts). Só usa
// Date para ler "hoje" (ano/mês corrente em UTC), nunca para aritmética de dias.

/**
 * Competência do mês anterior ao de `referencia` (default: agora). Usada pelo cron de
 * relatório mensal — roda no dia 1, precisa da competência que acabou de fechar.
 */
export function competenciaAnterior(referencia: Date = new Date()): string {
  const ano = referencia.getUTCFullYear();
  const mes0 = referencia.getUTCMonth(); // 0-indexed (0 = janeiro)
  const anterior0 = mes0 === 0 ? 11 : mes0 - 1;
  const anoAjustado = mes0 === 0 ? ano - 1 : ano;
  return `${anoAjustado}-${String(anterior0 + 1).padStart(2, '0')}`;
}
