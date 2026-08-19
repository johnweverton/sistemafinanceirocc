// Tipo de serviço — Cobrança Médica vs Contabilidade (migration 0049, feedback do dono
// 2026-08-19). Derivado de `execucao_resultados.cliente_contabilidade_id` (setado só quando o
// resultado é de cliente contábil, mutuamente exclusivo com medico_id/empresa_id) — NUNCA de
// `conta_emissora`, que desde a migration 0040 está liberada pra qualquer boleto do sistema
// (um médico pode emitir pela Carmem Cavalcante; um cliente contábil pode emitir pela MC).

export type TipoServico = 'cobranca_medica' | 'contabilidade';

/** Todas as opções válidas — fonte única pra UI/Zod (espelha o CASE da view). */
export const TIPOS_SERVICO_VALIDOS = [
  'cobranca_medica',
  'contabilidade',
] as const satisfies readonly TipoServico[];

/** Nome exibido de cada tipo de serviço — fonte ÚNICA dos rótulos, mesmo padrão de
 *  CONTA_EMISSORA_LABEL (conta-emissora.ts). */
export const TIPO_SERVICO_LABEL: Record<TipoServico, string> = {
  cobranca_medica: 'Cobrança Médica',
  contabilidade: 'Contabilidade',
};
