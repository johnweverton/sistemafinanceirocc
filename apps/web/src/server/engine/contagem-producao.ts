import type { ItemProducao, ResultadoContagem, ModoObservado } from '@cobranca/shared';


/**
 * Filtra itens válidos e inválidos.
 * Exige data e pacienteNome presentes. O statusOrigem NUNCA filtra.
 */
export function itensValidos(itens: ItemProducao[]): { validos: ItemProducao[]; invalidos: ItemProducao[] } {
  const validos: ItemProducao[] = [];
  const invalidos: ItemProducao[] = [];

  for (const item of itens) {
    if (item.data && item.data.trim() !== '' && item.pacienteNome && item.pacienteNome.trim() !== '') {
      validos.push(item);
    } else {
      invalidos.push(item);
    }
  }

  return { validos, invalidos };
}

/**
 * Retorna a chave de atendimento para agrupar guias.
 * Usa atendimentoExternoId (senha/atendimento na origem) se disponível.
 * Fallback: pacienteNome|data.
 */
export function chaveAtendimento(item: ItemProducao): string {
  if (item.atendimentoExternoId && item.atendimentoExternoId.trim() !== '') {
    return item.atendimentoExternoId;
  }
  return `${item.pacienteNome}|${item.data}`;
}

/**
 * Conta as guias e cirurgias a partir de itens da produção (via API), adaptado à semântica real:
 * - itens viaAcesso: 1 guia por chaveAtendimento, independente da especialidade.
 * - itens normais (pediatra): agrupados por (chaveAtendimento, data), cada balde = teto(qtd/3) guias.
 * - itens normais (não pediatra): 1 guia por item.
 */
export function contarGuiasProducao(itens: ItemProducao[], especialidade?: string | null): ResultadoContagem {
  const { validos } = itensValidos(itens);

  const viaAcessoItems = validos.filter((i) => i.viaAcesso);
  const outrosItems = validos.filter((i) => !i.viaAcesso);

  let guias = 0;
  
  // Cirurgias: quantidade de chaves de atendimento únicas (PRD §12).
  // Só aplicável para Pediatria ou viaAcesso.
  const gruposAtendimento = new Set<string>();
  for (const item of validos) {
    gruposAtendimento.add(chaveAtendimento(item));
  }
  let cirurgias = 0;
  if (isPediatra(especialidade) || viaAcessoItems.length > 0) {
    cirurgias = gruposAtendimento.size;
  }

  // viaAcesso agrupa por chaveAtendimento
  const viaAcessoGroups = new Set<string>();
  for (const item of viaAcessoItems) {
    viaAcessoGroups.add(chaveAtendimento(item));
  }
  guias += viaAcessoGroups.size;

  // Remaining
  if (isPediatra(especialidade)) {
    // Pediatra
    const porAtend = new Map<string, Map<string, number>>();
    for (const item of outrosItems) {
      const chave = chaveAtendimento(item);
      let datas = porAtend.get(chave);
      if (!datas) {
        datas = new Map<string, number>();
        porAtend.set(chave, datas);
      }
      datas.set(item.data, (datas.get(item.data) ?? 0) + 1);
    }

    for (const datas of porAtend.values()) {
      for (const count of datas.values()) {
        guias += Math.ceil(count / 3);
      }
    }
  } else {
    // Não-pediatra
    guias += outrosItems.length;
  }

  return { guias, cirurgias };
}

/**
 * Conta as consultas ambulatoriais de pediatria (Story 10.2) — itens de um LOTE SEPARADO
 * (produção distinta na origem, GATE do dono 2026-07-20), nunca o mesmo array de `itens` das
 * guias hospitalares (anti-dupla-contagem). Cada item válido = 1 consulta; sem agrupamento por
 * atendimento/data (diferente da regra teto(n/3) das guias — são conceitos distintos).
 */
export function contarConsultasProducao(itens: ItemProducao[]): number {
  return itensValidos(itens).validos.length;
}

export function isPediatra(especialidade?: string | null): boolean {
  if (!especialidade) return false;
  const esp = especialidade.toLowerCase();
  return esp.includes('pediatra') || esp.includes('pediatria');
}

/**
 * Detecta se existem grupos de atendimento com itens em mais de uma data (PRD §5.3).
 * QA M-3: a chave do grupo NÃO pode conter a data — usa atendimentoExternoId quando a
 * origem entregar; fallback é o PACIENTE (arquitetura §3.3). Se usasse chaveAtendimento()
 * (fallback paciente|data), um grupo jamais teria 2 datas e o modo seria sempre 'nao',
 * gerando alerta falso "MODO INCONSISTENTE" para pediatra cadastrado como 'sim'.
 */
export function detectarModoProducao(itens: ItemProducao[]): ModoObservado {
  const { validos } = itensValidos(itens);

  const porGrupo = new Map<string, Set<string>>();
  for (const item of validos) {
    const chave =
      item.atendimentoExternoId && item.atendimentoExternoId.trim() !== ''
        ? item.atendimentoExternoId
        : item.pacienteNome;
    let datas = porGrupo.get(chave);
    if (!datas) {
      datas = new Set<string>();
      porGrupo.set(chave, datas);
    }
    datas.add(item.data);
  }

  for (const datas of porGrupo.values()) {
    if (datas.size > 1) return 'sim';
  }

  return 'nao';
}

/**
 * Contagem informativa ignorando a data no agrupamento.
 */
export function consolidarProducao(itens: ItemProducao[], especialidade?: string | null): number {
  const { validos } = itensValidos(itens);

  const viaAcessoItems = validos.filter((i) => i.viaAcesso);
  const outrosItems = validos.filter((i) => !i.viaAcesso);

  let guias = 0;

  // viaAcesso agrupa por paciente
  const viaAcessoPacientes = new Set<string>();
  for (const item of viaAcessoItems) {
    viaAcessoPacientes.add(item.pacienteNome);
  }
  guias += viaAcessoPacientes.size;

  if (isPediatra(especialidade)) {
    const porPaciente = new Map<string, number>();
    for (const item of outrosItems) {
      porPaciente.set(item.pacienteNome, (porPaciente.get(item.pacienteNome) ?? 0) + 1);
    }
    for (const count of porPaciente.values()) {
      guias += Math.ceil(count / 3);
    }
  } else {
    guias += outrosItems.length;
  }

  return guias;
}
