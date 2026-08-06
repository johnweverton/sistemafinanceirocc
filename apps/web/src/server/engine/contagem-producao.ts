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
 * Chave de agrupamento HÍBRIDA para o 3x1 de pediatra (achado 2026-08-05): a origem ORA usa
 * `atendimentoExternoId` (senha) pra identificar corretamente UM atendimento com vários
 * procedimentos (PRD §12 — Dra. A/Dr. E: mesma senha em 3+ linhas, inclusive quando o
 * `pacienteNome` do dado é genérico/repetido entre atendimentos DIFERENTES do mesmo mês — usar
 * só o paciente misturaria atendimentos distintos), ORA dá uma senha PRÓPRIA a cada procedimento
 * (José Neias 2026-08-04, Bruno de Brito Botelho 2026-08-05: toda linha com senha única, nenhuma
 * repetida — usar a senha nesse caso fragmenta um único atendimento em várias guias).
 * Resolve os dois: usa a senha quando ela aparece em 2+ linhas (atendimento real, compartilhado);
 * cai para `pacienteNome` quando a senha é única por linha ou ausente.
 */
function chaveAgrupamento3x1(itens: ItemProducao[]): (item: ItemProducao) => string {
  const contagemSenha = new Map<string, number>();
  for (const item of itens) {
    if (item.atendimentoExternoId && item.atendimentoExternoId.trim() !== '') {
      contagemSenha.set(item.atendimentoExternoId, (contagemSenha.get(item.atendimentoExternoId) ?? 0) + 1);
    }
  }
  return (item: ItemProducao) => {
    const senha = item.atendimentoExternoId;
    if (senha && senha.trim() !== '' && (contagemSenha.get(senha) ?? 0) > 1) {
      return senha;
    }
    return item.pacienteNome;
  };
}

/**
 * Conta as guias e cirurgias a partir de itens da produção (via API), adaptado à semântica real:
 * - itens viaAcesso (pediatra): agrupados por (chaveAgrupamento3x1, data), cada balde =
 *   teto(qtd/3) guias — mesma regra 3x1 dos itens normais (achado real 2026-08-04, Dr. José
 *   Neias: cada procedimento de uma via de acesso ganha uma senha PRÓPRIA na origem — ex.: 3
 *   cirurgias do mesmo paciente no mesmo dia, 3 senhas diferentes — então agrupar por
 *   chaveAtendimento (senha) fragmenta o mesmo atendimento em várias guias, ignorando o 3x1 por
 *   completo). Ver `chaveAgrupamento3x1` para o caso em que a senha SE REPETE (atendimento real).
 * - itens viaAcesso (nem pediatra nem urologista): 1 guia por chaveAtendimento (comportamento
 *   original — sem evidência de que a mesma fragmentação por senha ocorra fora dessas duas
 *   especialidades).
 * - itens normais (pediatra ou urologista): agrupados por (chaveAgrupamento3x1, data), cada
 *   balde = teto(qtd/3) guias — mesma correção do bloco acima, agora nos itens normais também
 *   (achado real 2026-08-05, Dr. Bruno de Brito Botelho: 213 procedimentos NORMAIS, 213 senhas
 *   distintas — cobrava 213 guias em vez de ~80). PRD §12 (Dra. A/Dr. E) preservado: senhas
 *   compartilhadas por 2+ procedimentos continuam identificando o atendimento real.
 * - itens normais (nem pediatra nem urologista): 1 guia por item.
 * - urologista, EXCEÇÃO (GATE 2026-08-06): itens cujo `codigoProcedimento` está em
 *   `CODIGOS_EXCECAO_UROLOGISTA` nunca entram no agrupamento 3x1 acima (nem no ramo viaAcesso,
 *   nem no normal) — são retirados antes de qualquer agrupamento e cada ocorrência vira 1 guia
 *   cheia e individual, somada à parte.
 */
export function contarGuiasProducao(itens: ItemProducao[], especialidade?: string | null): ResultadoContagem {
  const { validos } = itensValidos(itens);

  const pediatra = isPediatra(especialidade);
  const urologista = isUrologista(especialidade);
  const usaTeto3x1 = pediatra || urologista;

  // Urologista: separa os 6 códigos de exceção ANTES de dividir por viaAcesso — eles não
  // entram no pool 3x1 em nenhum ramo, cada ocorrência é 1 guia individual (GATE 2026-08-06).
  const itensExcecao = urologista ? validos.filter(ehExcecaoUrologista) : [];
  const itensParaContagem = urologista ? validos.filter((i) => !ehExcecaoUrologista(i)) : validos;

  const viaAcessoItems = itensParaContagem.filter((i) => i.viaAcesso);
  const outrosItems = itensParaContagem.filter((i) => !i.viaAcesso);

  let guias = itensExcecao.length;

  // Cirurgias: quantidade de chaves de atendimento únicas (PRD §12) — métrica informativa,
  // independente da regra de guias acima; não muda com o achado 2026-08-04. Inclui itens de
  // exceção do urologista (é contagem de atendimento, não de guia cobrada).
  const gruposAtendimento = new Set<string>();
  for (const item of validos) {
    gruposAtendimento.add(chaveAtendimento(item));
  }
  let cirurgias = 0;
  if (usaTeto3x1 || viaAcessoItems.length > 0) {
    cirurgias = gruposAtendimento.size;
  }

  if (usaTeto3x1) {
    // Pediatra/urologista + via de acesso: teto(qtd/3) por (chaveAgrupamento3x1, data).
    const chaveViaAcesso = chaveAgrupamento3x1(viaAcessoItems);
    const porPacienteViaAcesso = new Map<string, Map<string, number>>();
    for (const item of viaAcessoItems) {
      const chave = chaveViaAcesso(item);
      let datas = porPacienteViaAcesso.get(chave);
      if (!datas) {
        datas = new Map<string, number>();
        porPacienteViaAcesso.set(chave, datas);
      }
      datas.set(item.data, (datas.get(item.data) ?? 0) + 1);
    }
    for (const datas of porPacienteViaAcesso.values()) {
      for (const count of datas.values()) {
        guias += Math.ceil(count / 3);
      }
    }
  } else {
    // Nem pediatra nem urologista: via de acesso continua 1 guia por chaveAtendimento (comportamento original).
    const viaAcessoGroups = new Set<string>();
    for (const item of viaAcessoItems) {
      viaAcessoGroups.add(chaveAtendimento(item));
    }
    guias += viaAcessoGroups.size;
  }

  // Remaining
  if (usaTeto3x1) {
    // Pediatra/urologista: teto(qtd/3) por (chaveAgrupamento3x1, data).
    const chaveOutros = chaveAgrupamento3x1(outrosItems);
    const porAtend = new Map<string, Map<string, number>>();
    for (const item of outrosItems) {
      const chave = chaveOutros(item);
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
    // Nem pediatra nem urologista
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
 * Detecta urologista pelo prefixo "urolog" (Urologia/Urologista, case-insensitive) — mesmo
 * padrão de isPediatra. Casos combinados como "Cirurgião Geral / Urologista" também batem
 * (decisão consciente, GATE do usuário 2026-08-06).
 */
export function isUrologista(especialidade?: string | null): boolean {
  if (!especialidade) return false;
  return especialidade.toLowerCase().includes('urolog');
}

/**
 * Códigos TUSS excluídos do pool 3x1 do urologista (regra aprovada pelo usuário, 2026-08-06):
 * cada ocorrência conta como 1 guia cheia e individual, fora do agrupamento teto(n/3) — não
 * dilui nem é diluída pelo pool dos demais procedimentos.
 */
export const CODIGOS_EXCECAO_UROLOGISTA: ReadonlySet<string> = new Set([
  '3.11.02.03-4', // Cateterismo ureteral unilateral
  '3.09.13.01-2', // Dissecção de veia para colocação de cateter central NPP ou QT
  '4.09.02.05-6', // Intra-operatório
  '3.12.05.04-6', // Vasectomia unilateral
  '3.09.06.16-4', // Cateterismo de artéria radial PAM
  '4.08.11.02-6', // Radioscopia para acompanhamento cirúrgico
]);

/**
 * `.trim()` defensivo: o mapper do proc_code (fin-api-client.ts) não trima o valor, diferente
 * de outros campos do item — evita falso negativo silencioso por espaço acidental na origem.
 */
function ehExcecaoUrologista(item: ItemProducao): boolean {
  return CODIGOS_EXCECAO_UROLOGISTA.has((item.codigoProcedimento ?? '').trim());
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

  const pediatra = isPediatra(especialidade);
  const urologista = isUrologista(especialidade);
  const usaTeto3x1 = pediatra || urologista;

  // Mesma exceção de contarGuiasProducao (GATE 2026-08-06): consolidado do urologista segue a
  // MESMA regra completa do valor real cobrado, pra não ficar um número informativo divergente.
  const itensExcecao = urologista ? validos.filter(ehExcecaoUrologista) : [];
  const itensParaContagem = urologista ? validos.filter((i) => !ehExcecaoUrologista(i)) : validos;

  const viaAcessoItems = itensParaContagem.filter((i) => i.viaAcesso);
  const outrosItems = itensParaContagem.filter((i) => !i.viaAcesso);

  let guias = itensExcecao.length;

  // viaAcesso agrupa por paciente (ignorando data, por isso "consolidado"). Pediatra/urologista
  // aplicam o teto(qtd/3) aqui também (achado 2026-08-04, mesmo motivo de contarGuiasProducao) —
  // sem isso, este número informativo ficava sistematicamente ABAIXO do valor correto para
  // pediatras com >3 procedimentos via de acesso no mesmo paciente.
  if (usaTeto3x1) {
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

  if (usaTeto3x1) {
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
