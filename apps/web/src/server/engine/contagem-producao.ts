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
 * - itens viaAcesso (pediatra): agrupados por (pacienteNome, data), cada balde = teto(qtd/3)
 *   guias — mesma regra 3x1 dos itens normais (achado real 2026-08-04, Dr. José Neias: cada
 *   procedimento de uma via de acesso ganha uma senha PRÓPRIA na origem — ex.: 3 cirurgias do
 *   mesmo paciente no mesmo dia, 3 senhas diferentes — então agrupar por chaveAtendimento
 *   (senha) fragmenta o mesmo atendimento em várias guias, ignorando o 3x1 por completo).
 * - itens viaAcesso (não pediatra): 1 guia por chaveAtendimento (comportamento original —
 *   sem evidência de que a mesma fragmentação por senha ocorra fora de pediatria).
 * - itens normais (pediatra): agrupados por (chaveAtendimento, data), cada balde = teto(qtd/3) guias.
 * - itens normais (não pediatra): 1 guia por item.
 */
export function contarGuiasProducao(itens: ItemProducao[], especialidade?: string | null): ResultadoContagem {
  const { validos } = itensValidos(itens);

  const viaAcessoItems = validos.filter((i) => i.viaAcesso);
  const outrosItems = validos.filter((i) => !i.viaAcesso);
  const pediatra = isPediatra(especialidade);

  let guias = 0;

  // Cirurgias: quantidade de chaves de atendimento únicas (PRD §12) — métrica informativa,
  // independente da regra de guias acima; não muda com o achado 2026-08-04.
  const gruposAtendimento = new Set<string>();
  for (const item of validos) {
    gruposAtendimento.add(chaveAtendimento(item));
  }
  let cirurgias = 0;
  if (pediatra || viaAcessoItems.length > 0) {
    cirurgias = gruposAtendimento.size;
  }

  if (pediatra) {
    // Pediatra + via de acesso: teto(qtd/3) por (paciente, data) — NUNCA por chaveAtendimento
    // (senha), que é por procedimento, não por atendimento, nesses itens.
    const porPacienteViaAcesso = new Map<string, Map<string, number>>();
    for (const item of viaAcessoItems) {
      let datas = porPacienteViaAcesso.get(item.pacienteNome);
      if (!datas) {
        datas = new Map<string, number>();
        porPacienteViaAcesso.set(item.pacienteNome, datas);
      }
      datas.set(item.data, (datas.get(item.data) ?? 0) + 1);
    }
    for (const datas of porPacienteViaAcesso.values()) {
      for (const count of datas.values()) {
        guias += Math.ceil(count / 3);
      }
    }
  } else {
    // Não-pediatra: via de acesso continua 1 guia por chaveAtendimento (comportamento original).
    const viaAcessoGroups = new Set<string>();
    for (const item of viaAcessoItems) {
      viaAcessoGroups.add(chaveAtendimento(item));
    }
    guias += viaAcessoGroups.size;
  }

  // Remaining
  if (pediatra) {
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

/**
 * Filtra os itens de um lote que agregue várias competências dentro do mesmo id de produção
 * (Story 10.6 — "Outros Hospitais" na origem não abre uma produção por mês, como o lote
 * principal; um único lote acumula meses diferentes). Compara `item.data` (AAAA-MM-DD) com a
 * competência da execução (AAAA-MM) — item sem `data` passa direto (é tratado à parte por
 * `itensValidos`, não é um descarte por competência). Devolve também quantos itens foram
 * descartados por serem de outro mês, para o alerta "nunca chuta" informar o operador.
 */
export function filtrarPorCompetencia(
  itens: ItemProducao[],
  competencia: string,
): { itensDaCompetencia: ItemProducao[]; ignoradosPorCompetencia: number } {
  let ignoradosPorCompetencia = 0;
  const itensDaCompetencia = itens.filter((item) => {
    if (!item.data || item.data.trim() === '') return true;
    if (item.data.slice(0, 7) === competencia) return true;
    ignoradosPorCompetencia++;
    return false;
  });
  return { itensDaCompetencia, ignoradosPorCompetencia };
}

/**
 * Detecta pediatra pelo prefixo "pediatr" (não exige a palavra completa) — achado real
 * 2026-08-04, Dr. José Neias: especialidade cadastrada como "Pediatr" (truncada na origem/
 * importação), e a checagem exata por "pediatra"/"pediatria" não reconhecia o médico como
 * pediatra, pulando a regra 3x1 por completo (cobrança de 38 guias em vez de 19). GATE do dono:
 * variações/truncamentos como esse ainda significam pediatra.
 */
export function isPediatra(especialidade?: string | null): boolean {
  if (!especialidade) return false;
  return especialidade.toLowerCase().includes('pediatr');
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

  const pediatra = isPediatra(especialidade);
  let guias = 0;

  // viaAcesso agrupa por paciente (ignorando data, por isso "consolidado"). Pediatra aplica o
  // teto(qtd/3) aqui também (achado 2026-08-04, mesmo motivo de contarGuiasProducao) — sem
  // isso, este número informativo ficava sistematicamente ABAIXO do valor correto para
  // pediatras com >3 procedimentos via de acesso no mesmo paciente.
  if (pediatra) {
    const porPacienteViaAcesso = new Map<string, number>();
    for (const item of viaAcessoItems) {
      porPacienteViaAcesso.set(item.pacienteNome, (porPacienteViaAcesso.get(item.pacienteNome) ?? 0) + 1);
    }
    for (const count of porPacienteViaAcesso.values()) {
      guias += Math.ceil(count / 3);
    }
  } else {
    const viaAcessoPacientes = new Set<string>();
    for (const item of viaAcessoItems) {
      viaAcessoPacientes.add(item.pacienteNome);
    }
    guias += viaAcessoPacientes.size;
  }

  if (pediatra) {
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
