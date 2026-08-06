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
 * cai para `paciente + código de procedimento` quando a senha é única por linha ou ausente.
 *
 * O código de procedimento entra no fallback por causa do achado real 2026-08-06 (Dr. Jansen
 * Osterno Vasconcelos, pediatra): sem senha confiável, paciente+data sozinho fundiu 3 pares de
 * atendimentos GENUINAMENTE separados que só coincidiram na data (222 cirurgias → 219 guias,
 * -3 errado — confirmado pelo dono: "são dois atendimentos genuinamente separados"). Exigir
 * também o MESMO código resolve os dois casos reais conhecidos: mesmo procedimento repetido no
 * mesmo dia sem senha compartilhada (padrão "via de acesso 3x", achado 2026-08-04 — ainda
 * agrupa, é o cenário que a regra 3x1 foi desenhada pra cobrir) continua colapsando; códigos
 * DIFERENTES no mesmo dia (Jansen) não colapsam mais — cada um vira seu próprio grupo.
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
    return `${item.pacienteNome}|${item.codigoProcedimento}`;
  };
}

/**
 * Conta as guias e cirurgias a partir de itens da produção (via API), adaptado à semântica real:
 * - itens viaAcesso (especialidade 3x1 — pediatra/urologista/ginecologista/ortopedista):
 *   agrupados por (chaveAgrupamento3x1, data), cada balde = teto(qtd/3) guias — mesma regra 3x1
 *   dos itens normais (achado real 2026-08-04, Dr. José Neias: cada procedimento de uma via de
 *   acesso ganha uma senha PRÓPRIA na origem — ex.: 3 cirurgias do mesmo paciente no mesmo dia,
 *   3 senhas diferentes — então agrupar por chaveAtendimento (senha) fragmenta o mesmo
 *   atendimento em várias guias, ignorando o 3x1 por completo). Ver `chaveAgrupamento3x1` para
 *   o caso em que a senha SE REPETE (atendimento real).
 * - itens viaAcesso (nenhuma especialidade 3x1): 1 guia por chaveAtendimento (comportamento
 *   original — sem evidência de que a mesma fragmentação por senha ocorra fora dessas
 *   especialidades).
 * - itens normais (especialidade 3x1): agrupados por (chaveAgrupamento3x1, data), cada
 *   balde = teto(qtd/3) guias — mesma correção do bloco acima, agora nos itens normais também
 *   (achado real 2026-08-05, Dr. Bruno de Brito Botelho: 213 procedimentos NORMAIS, 213 senhas
 *   distintas — cobrava 213 guias em vez de ~80). PRD §12 (Dra. A/Dr. E) preservado: senhas
 *   compartilhadas por 2+ procedimentos continuam identificando o atendimento real.
 * - itens normais (nenhuma especialidade 3x1): 1 guia por item.
 * - urologista/ginecologista, EXCEÇÃO (GATE 2026-08-06): itens cujo `codigoProcedimento` está
 *   no conjunto de exceção da especialidade (ver `codigosExcecaoPara`) nunca entram no
 *   agrupamento 3x1 acima (nem no ramo viaAcesso, nem no normal) — são retirados antes de
 *   qualquer agrupamento e cada ocorrência vira 1 guia cheia e individual, somada à parte.
 *   Ortopedista usa o MESMO teto(n/3), mas sem lista de exceção — todo procedimento entra no
 *   pool normalmente (pedido explícito do dono, GATE 2026-08-06).
 */
export function contarGuiasProducao(itens: ItemProducao[], especialidade?: string | null): ResultadoContagem {
  const { validos } = itensValidos(itens);

  const usaTeto3x1 = usaRegra3x1(especialidade);
  const codigosExcecao = codigosExcecaoPara(especialidade);

  // Separa os itens de exceção (se a especialidade tiver alguma) ANTES de dividir por
  // viaAcesso — eles não entram no pool 3x1 em nenhum ramo, cada ocorrência é 1 guia individual
  // (GATE 2026-08-06). Conjunto vazio (pediatra/ortopedista/nenhuma 3x1) → ambos os filtros
  // degeneram para [] e `validos`, sem custo extra de lógica condicional.
  const itensExcecao = validos.filter((i) => ehExcecao(i, codigosExcecao));
  const itensParaContagem = validos.filter((i) => !ehExcecao(i, codigosExcecao));

  const viaAcessoItems = itensParaContagem.filter((i) => i.viaAcesso);
  const outrosItems = itensParaContagem.filter((i) => !i.viaAcesso);

  let guias = itensExcecao.length;

  // Cirurgias: quantidade de chaves de atendimento únicas (PRD §12) — métrica informativa,
  // independente da regra de guias acima; não muda com o achado 2026-08-04. Inclui itens de
  // exceção (é contagem de atendimento, não de guia cobrada).
  const gruposAtendimento = new Set<string>();
  for (const item of validos) {
    gruposAtendimento.add(chaveAtendimento(item));
  }
  let cirurgias = 0;
  if (usaTeto3x1 || viaAcessoItems.length > 0) {
    cirurgias = gruposAtendimento.size;
  }

  if (usaTeto3x1) {
    // Especialidade 3x1 + via de acesso: teto(qtd/3) por (chaveAgrupamento3x1, data).
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
    // Nenhuma especialidade 3x1: via de acesso continua 1 guia por chaveAtendimento (comportamento original).
    const viaAcessoGroups = new Set<string>();
    for (const item of viaAcessoItems) {
      viaAcessoGroups.add(chaveAtendimento(item));
    }
    guias += viaAcessoGroups.size;
  }

  // Remaining
  if (usaTeto3x1) {
    // Especialidade 3x1: teto(qtd/3) por (chaveAgrupamento3x1, data).
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
    // Nenhuma especialidade 3x1
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
 * Detecta ginecologista pelo prefixo "ginecolog" (Ginecologia/Ginecologista/Ginecologia e
 * Obstetrícia etc., case-insensitive) — mesmo padrão de isPediatra/isUrologista. GATE
 * 2026-08-06: coordenadora financeira pediu a mesma regra 3x1 + exceção de códigos da
 * urologia, agora pra ginecologia (que faz cirurgias normais além de inserção de DIU e
 * histerectomias) — a lista de exceção em si (`CODIGOS_EXCECAO_GINECOLOGISTA`) cobre
 * especificamente as 2 inserções de DIU e a histeroscopia cirúrgica aprovadas pelo usuário,
 * não toda a categoria de "inserção/remoção de DIU/histerectomia" citada no pedido original.
 */
export function isGinecologista(especialidade?: string | null): boolean {
  if (!especialidade) return false;
  return especialidade.toLowerCase().includes('ginecolog');
}

/**
 * Detecta ortopedista pelo prefixo "ortoped" (Ortopedia/Ortopedista, case-insensitive) — mesmo
 * padrão das demais. Ortopedia usa o teto(n/3) igual às outras especialidades 3x1, mas SEM
 * lista de exceção de códigos (GATE 2026-08-06, pedido explícito do dono: "sem essa
 * especifidade" — todo procedimento entra no pool, nenhum é retirado à parte).
 */
export function isOrtopedista(especialidade?: string | null): boolean {
  if (!especialidade) return false;
  return especialidade.toLowerCase().includes('ortoped');
}

/**
 * Especialidades que usam o teto(n/3) por atendimento em vez de 1 guia por procedimento (PRD
 * §12; GATE 2026-08-06 ampliando de pediatra/urologista para ginecologista/ortopedista).
 * Exportada (não só uso interno) porque `conferencia.ts` reusa o mesmo critério pro alerta de
 * "MODO INCONSISTENTE" — a ambiguidade senha-vs-paciente que esse alerta cobre é do mecanismo
 * de agrupamento 3x1 em si (`chaveAgrupamento3x1`/`detectarModoProducao`), não algo exclusivo
 * de pediatra (achado 2026-08-06: o campo "Mudança de data" só aparecia no cadastro pra
 * pediatra, mas as 3 especialidades novas usam o MESMO agrupamento e têm a MESMA ambiguidade).
 */
export function usaRegra3x1(especialidade?: string | null): boolean {
  return (
    isPediatra(especialidade) ||
    isUrologista(especialidade) ||
    isGinecologista(especialidade) ||
    isOrtopedista(especialidade)
  );
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
 * Códigos TUSS excluídos do pool 3x1 do ginecologista (regra aprovada pelo usuário, 2026-08-06,
 * mesmo mecanismo do urologista): inserções de DIU e a histeroscopia cirúrgica abaixo nunca
 * entram no agrupamento teto(n/3) — cada ocorrência é 1 guia cheia e individual.
 */
export const CODIGOS_EXCECAO_GINECOLOGISTA: ReadonlySet<string> = new Set([
  '3.13.03.29-3', // Implante de DIU hormonal — inserção
  '3.13.03.26-9', // Implante de DIU não hormonal — inserção
  '3.13.03.17-0', // Histeroscopia cirúrgica p/ biópsia dirigida, lise de sinéquias, retirada de corpo estranho
]);

/**
 * Normaliza um código de procedimento pra só dígitos — resolve a divergência de formato entre
 * a notação TUSS documentada ("3.13.03.29-3", usada nas constantes acima, mais legível/
 * auditável) e o que a API real do sistema web efetivamente manda em `proc_code`: dígitos
 * puros, sem pontuação ("31303293"). BUG REAL 2026-08-06 (Dr. Márcio Erlon Fontinele Moreira,
 * ginecologista): comparar os dois formatos direto NUNCA batia — nenhuma exceção era
 * reconhecida, todos os 248 procedimentos caíam no pool 3x1 (169 guias em vez das 189
 * corretas). Mesmo bug provavelmente afeta CODIGOS_EXCECAO_UROLOGISTA desde a implementação
 * original (mesma API, mesmo campo `proc_code`) — nunca confirmado porque não havia caso real
 * de exceção de urologista auditado até agora.
 */
function normalizarCodigo(codigo: string): string {
  return codigo.replace(/\D/g, '');
}

const CODIGOS_EXCECAO_UROLOGISTA_NORM: ReadonlySet<string> = new Set(
  [...CODIGOS_EXCECAO_UROLOGISTA].map(normalizarCodigo),
);
const CODIGOS_EXCECAO_GINECOLOGISTA_NORM: ReadonlySet<string> = new Set(
  [...CODIGOS_EXCECAO_GINECOLOGISTA].map(normalizarCodigo),
);

/** Conjunto vazio compartilhado — especialidade sem lista de exceção própria (pediatra,
 *  ortopedista, ou nenhuma 3x1). Constante única em vez de `new Set()` por chamada: é o caso
 *  mais comum (todo médico fora de urologia/ginecologia cai aqui). */
const SEM_EXCECAO: ReadonlySet<string> = new Set();

/**
 * Resolve o conjunto de códigos de exceção da especialidade do médico. Ortopedista usa 3x1 mas
 * SEM exceção (GATE 2026-08-06, pedido explícito do dono) — cai direto no `SEM_EXCECAO` abaixo,
 * não tem branch própria.
 *
 * PRECEDÊNCIA (não especificada pelo usuário, decisão de implementação): se a especialidade
 * cadastrada bater com UROLOGISTA e GINECOLOGISTA ao mesmo tempo (texto composto, ex.:
 * hipotético "Ginecologia e Urologia" — sem caso real conhecido na base hoje, mas
 * "Cirurgião Geral / Urologista" já mostrou que textos compostos acontecem), urologista tem
 * prioridade e a lista do ginecologista é ignorada. Nunca faz união das duas listas. Se
 * aparecer um médico real nesse caso, resolver explicitamente (união ou uma regra de
 * prioridade combinada) em vez de depender desta ordem implícita de `if`.
 */
function codigosExcecaoPara(especialidade?: string | null): ReadonlySet<string> {
  if (isUrologista(especialidade)) return CODIGOS_EXCECAO_UROLOGISTA_NORM;
  if (isGinecologista(especialidade)) return CODIGOS_EXCECAO_GINECOLOGISTA_NORM;
  return SEM_EXCECAO;
}

/**
 * Compara por dígitos normalizados dos dois lados (ver `normalizarCodigo`) — não importa se o
 * código do item chega pontuado ("3.13.03.29-3") ou cru ("31303293", formato real observado),
 * nem se tem espaço em volta (mapper do proc_code em fin-api-client.ts não trima o valor).
 */
function ehExcecao(item: ItemProducao, codigos: ReadonlySet<string>): boolean {
  return codigos.has(normalizarCodigo(item.codigoProcedimento ?? ''));
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

  const usaTeto3x1 = usaRegra3x1(especialidade);
  const codigosExcecao = codigosExcecaoPara(especialidade);

  // Mesma exceção de contarGuiasProducao (GATE 2026-08-06): consolidado segue a MESMA regra
  // completa do valor real cobrado, pra não ficar um número informativo divergente.
  const itensExcecao = validos.filter((i) => ehExcecao(i, codigosExcecao));
  const itensParaContagem = validos.filter((i) => !ehExcecao(i, codigosExcecao));

  const viaAcessoItems = itensParaContagem.filter((i) => i.viaAcesso);
  const outrosItems = itensParaContagem.filter((i) => !i.viaAcesso);

  let guias = itensExcecao.length;

  // viaAcesso agrupa por paciente (ignorando data, por isso "consolidado"). Especialidades 3x1
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
