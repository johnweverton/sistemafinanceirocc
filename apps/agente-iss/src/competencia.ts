// Competência: o sistema usa 'AAAA-MM'; o portal usa 'MM/AAAA' (filtro e tabela) e
// '01/MM/AAAA' (campo oculto `dataCompentencia` da visualização — grafia do próprio portal).

const RE_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export function competenciaValida(c: string): boolean {
  return RE_COMPETENCIA.test(c);
}

/**
 * Mês anterior ao de `hoje`, no relógio LOCAL (o agente roda no computador do escritório, e o
 * processo manual é "fechar o mês anterior ao vigente" — em set/2026 → 2026-08).
 */
export function competenciaAnterior(hoje: Date = new Date()): string {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth(); // 0-11 → o próprio índice já é "mês anterior" em 1-12
  return mes === 0 ? `${ano - 1}-12` : `${ano}-${String(mes).padStart(2, '0')}`;
}

/** '2026-08' → '08/2026' */
export function competenciaPortal(c: string): string {
  const [ano, mes] = c.split('-');
  return `${mes}/${ano}`;
}

/** '2026-08' → '01/08/2026' (valor do campo oculto `dataCompentencia` na visualização) */
export function dataCompetenciaPortal(c: string): string {
  return `01/${competenciaPortal(c)}`;
}
