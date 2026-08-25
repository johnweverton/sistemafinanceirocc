// Aritmética de competência (AAAA-MM) — função pura, sem passar por Date pra evitar
// deslocamento de fuso horário (mesmo cuidado de formatarDataBR em mensagem-boleto.ts). Só usa
// Date para ler "hoje" (ano/mês corrente), nunca para aritmética de dias — cada função documenta
// se lê o relógio local (tela) ou UTC (cron).

/**
 * Competência do mês corrente de `referencia` (default: agora), no fuso do RELÓGIO LOCAL.
 *
 * Consolida as 3 cópias idênticas que viviam em `LoteContabilidadeDialog`, `GerarExecucao` e
 * `FaturamentoEEmissao` (Épico 12, story 12.2 — gap G-28). Serve só para PRÉ-PREENCHER o campo
 * de competência na tela; o operador sempre pode trocar.
 *
 * Por que local e não UTC (ao contrário de `competenciaAnterior` logo abaixo): esta roda no
 * navegador do operador. Em UTC-3, dia 31 às 21h já é o dia 1 do mês seguinte em UTC — o campo
 * abriria com o mês errado justamente no fim do mês, que é quando o fechamento acontece.
 * `competenciaAnterior` roda no cron (servidor em UTC) e por isso lê em UTC. As duas leituras
 * são deliberadas; não unificar sem revisar os dois chamadores.
 */
export function competenciaAtual(referencia: Date = new Date()): string {
  return `${referencia.getFullYear()}-${String(referencia.getMonth() + 1).padStart(2, '0')}`;
}

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
