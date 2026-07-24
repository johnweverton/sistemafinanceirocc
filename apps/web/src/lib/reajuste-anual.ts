// Aviso (só informativo, nunca automatiza nada — decisão D5 do desenho arquitetural) de que o
// reajuste anual de um cliente contábil no modo `fixo` pode estar atrasado. Função pura, sem I/O.

interface EventoHistorico {
  campoAlterado: string;
  alteradoEm: string;
}

/**
 * Data de referência do último reajuste: a alteração mais recente de `regraPreco` no histórico,
 * ou a data de cadastro (`criadoEm`) se a regra nunca foi alterada.
 */
function dataUltimoReajuste(historico: EventoHistorico[], criadoEm: string): string {
  const mudancasRegra = historico.filter((h) => h.campoAlterado === 'regraPreco');
  if (mudancasRegra.length === 0) return criadoEm;
  return mudancasRegra.reduce((maisRecente, h) => (h.alteradoEm > maisRecente ? h.alteradoEm : maisRecente), mudancasRegra[0]!.alteradoEm);
}

/** True quando o último reajuste (ou o cadastro, se nunca reajustado) tem 12 meses ou mais. */
export function reajusteAnualPendente(historico: EventoHistorico[], criadoEm: string, hoje: Date): boolean {
  const referencia = new Date(dataUltimoReajuste(historico, criadoEm));
  if (Number.isNaN(referencia.getTime())) return false;
  const mesesDesde = (hoje.getFullYear() - referencia.getFullYear()) * 12 + (hoje.getMonth() - referencia.getMonth());
  return mesesDesde >= 12;
}
