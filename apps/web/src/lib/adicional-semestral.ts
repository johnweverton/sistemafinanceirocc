// Indicador (só sugestão de UI, nunca dispara nada sozinho) de que a competência informada bate
// o ciclo do adicional semestral de um cliente contábil. Função pura, sem I/O.

/**
 * True quando `competencia` ('YYYY-MM') cai exatamente num múltiplo de `intervaloMeses` a partir
 * de `competenciaBase` ('YYYY-MM'). Competências ANTES da base nunca "vencem" (retorna false).
 */
export function cicloAdicionalVencendoNaCompetencia(
  competenciaBase: string,
  intervaloMeses: number,
  competencia: string,
): boolean {
  const [anoBase, mesBase] = competenciaBase.split('-').map(Number);
  const [ano, mes] = competencia.split('-').map(Number);
  if (!anoBase || !mesBase || !ano || !mes || intervaloMeses <= 0) return false;

  const mesesBase = anoBase * 12 + (mesBase - 1);
  const mesesAtual = ano * 12 + (mes - 1);
  const diferenca = mesesAtual - mesesBase;
  if (diferenca < 0) return false;
  return diferenca % intervaloMeses === 0;
}
