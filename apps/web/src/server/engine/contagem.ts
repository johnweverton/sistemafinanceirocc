// Motor de contagem de guias — porte 1:1 de motor_guias_v2.py (contar_guias, detectar_modo).
// PRD §5.2 (regra de contagem) e §5.3 (modo observado). Função pura, sem I/O.
import type { Procedimento, ResultadoContagem, ModoObservado } from '@cobranca/shared';

/**
 * Filtra linhas inválidas (PRD §5.6): sem número de atendimento ou sem senha são
 * resíduo de template / linha-fantasma — ignorar, não contar.
 * Espelha o filtro de `buscar_local` no motor Python (atend/senha None → skip).
 */
export function procedimentosValidos(procedimentos: Procedimento[]): Procedimento[] {
  return procedimentos.filter(
    (p) =>
      p.numeroAtendimento != null &&
      p.numeroAtendimento !== '' &&
      p.senhaProcedimento != null &&
      p.senhaProcedimento !== '',
  );
}

/**
 * Verifica se a especialidade do médico indica que é Pediatra.
 */
export function isPediatra(especialidade: string | null | undefined): boolean {
  if (!especialidade) return false;
  const esp = especialidade.toLowerCase();
  return esp.includes('pediatr'); // abrange pediatra, pediatria
}

/**
 * Regra única (PRD §5.2): agrupa por (numeroAtendimento, dataProcedimento),
 * cada balde vira teto(qtd/3) guias. Cobre os dois modos sem ler configuração.
 * Retorna também o número de cirurgias = quantidade de atendimentos distintos.
 *
 * Espelha contar_guias() do Python:
 *   por_atend[atend][data] += 1 ; total = sum(ceil(n/3)) ; cirurgias = len(por_atend)
 */

export function contarGuias(
  procedimentos: Procedimento[],
  especialidade?: string | null,
): ResultadoContagem {
  const validos = procedimentosValidos(procedimentos);

  if (!isPediatra(especialidade)) {
    // Para outras especialidades, a regra é 1 guia por procedimento.
    return { guias: validos.length, cirurgias: 0 };
  }

  const porAtend = new Map<string, Map<string, number>>();

  for (const p of validos) {
    let datas = porAtend.get(p.numeroAtendimento);
    if (!datas) {
      datas = new Map<string, number>();
      porAtend.set(p.numeroAtendimento, datas);
    }
    datas.set(p.dataProcedimento, (datas.get(p.dataProcedimento) ?? 0) + 1);
  }

  let guias = 0;
  for (const datas of porAtend.values()) {
    for (const n of datas.values()) {
      guias += Math.ceil(n / 3);
    }
  }

  return { guias, cirurgias: porAtend.size };
}

/**
 * Contagem "consolidada": agrupa por atendimento ignorando datas (PRD §5.3).
 * Informativo na revisão — mostra a diferença vs. a contagem por data.
 * Cada atendimento vira teto(totalProcedimentosDoAtendimento / 3) guias.
 */

export function consolidarPorAtendimento(
  procedimentos: Procedimento[],
  especialidade?: string | null,
): number {
  const validos = procedimentosValidos(procedimentos);

  if (!isPediatra(especialidade)) {
    return validos.length;
  }

  const porAtend = new Map<string, number>();
  for (const p of validos) {
    porAtend.set(p.numeroAtendimento, (porAtend.get(p.numeroAtendimento) ?? 0) + 1);
  }
  let total = 0;
  for (const n of porAtend.values()) {
    total += Math.ceil(n / 3);
  }
  return total;
}

/**
 * Detecta o modo observado pelo padrão de datas dentro de cada atendimento (PRD §5.3).
 * Se algum atendimento tem procedimentos em mais de uma data → 'sim'; senão 'nao'.
 * Espelha detectar_modo() do Python.
 */
export function detectarModo(procedimentos: Procedimento[]): ModoObservado {
  const validos = procedimentosValidos(procedimentos);
  const porAtend = new Map<string, Set<string>>();
  for (const p of validos) {
    let datas = porAtend.get(p.numeroAtendimento);
    if (!datas) {
      datas = new Set<string>();
      porAtend.set(p.numeroAtendimento, datas);
    }
    datas.add(p.dataProcedimento);
  }
  for (const datas of porAtend.values()) {
    if (datas.size > 1) return 'sim';
  }
  return 'nao';
}
