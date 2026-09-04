import type { ItemProducao, ResultadoContagem, ModoObservado } from '@cobranca/shared';


/** Predicado de validade compartilhado por `itensValidos` e `detalharContagemGuias` — exige data
 *  e pacienteNome presentes. O statusOrigem NUNCA filtra. */
function ehItemValido(item: ItemProducao): boolean {
  return Boolean(item.data && item.data.trim() !== '' && item.pacienteNome && item.pacienteNome.trim() !== '');
}

/**
 * Filtra itens válidos e inválidos.
 * Exige data e pacienteNome presentes. O statusOrigem NUNCA filtra.
 */
export function itensValidos(itens: ItemProducao[]): { validos: ItemProducao[]; invalidos: ItemProducao[] } {
  const validos: ItemProducao[] = [];
  const invalidos: ItemProducao[] = [];

  for (const item of itens) {
    if (ehItemValido(item)) {
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
 *
 * LIMITAÇÃO CONHECIDA, decisão consciente do dono (GATE 2026-08-07): sem senha confiável, esse
 * fallback por paciente+data (SEM o código do procedimento) funde corretamente a MAIORIA dos
 * casos reais — Dr. Felipe de Brito Rocha (44 de 46 pacientes com múltiplos procedimentos
 * DIFERENTES no mesmo dia, todos legitimamente UM atendimento; guias tinha que dar 52, não 134)
 * e o Dr. Márcio Erlon Fontinele Moreira (cirurgias ginecológicas combinadas no mesmo dia).
 * Só o Dr. Jansen Osterno Vasconcelos é uma exceção CONHECIDA e CONFIRMADA (2026-08-06/07): 3
 * pares de atendimentos genuinamente separados que só coincidiram no paciente+data acabam
 * colapsados incorretamente (222 cirurgias reais → 219 guias, deveria ser 222). Chegou a existir
 * uma versão desta função que exigia também o MESMO código (resolvia o Jansen), mas quebrava os
 * outros dois casos, que são o padrão mais comum — decisão do dono: reverter pro fallback
 * simples e tratar o Jansen como correção manual pontual (fora do motor), não como regra geral.
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
 * - urologista/ginecologista, EXCEÇÃO (GATE 2026-08-06/07): itens que a especialidade marca
 *   como exceção (ver `ehExcecao` — urologista por código, ginecologista por descrição) nunca
 *   entram no agrupamento 3x1 acima (nem no ramo viaAcesso, nem no normal) — são retirados
 *   antes de qualquer agrupamento e cada ocorrência vira 1 guia cheia e individual, somada à
 *   parte. Ortopedista usa o MESMO teto(n/3), mas sem exceção — todo procedimento entra no
 *   pool normalmente (pedido explícito do dono, GATE 2026-08-06).
 */
/** Qual dos 3 tratamentos de agrupamento um item recebeu em `detalharContagemGuias`: `'excecao'`
 *  (fora do pool 3x1, 1 guia cheia individual — GATE 2026-08-06), `'viaAcesso'` ou `'outros'`
 *  (os dois ramos que já existiam em `contarGuiasProducao` antes deste achado). */
export type RamoContagem = 'excecao' | 'viaAcesso' | 'outros';

/**
 * Detalhe de agrupamento de UM item — a que grupo ele foi somado e quantas guias aquele grupo
 * gerou. Achado 2026-09-04 (auditoria 3x1, Dra. Emilie: contagem manual deu 59, sistema deu 69,
 * segunda conferência manual deu 61 — divergência real, sem forma de ver ONDE o agrupamento
 * discordava da contagem manual item a item). Existe para alimentar a planilha de auditoria
 * exportável (`auditoria-3x1-excel.ts`); nunca é a fonte da contagem em si — é o contrário:
 * `contarGuiasProducao` (abaixo) É a soma deste detalhe, garantindo que a planilha de auditoria
 * NUNCA possa divergir do valor efetivamente cobrado (reimplementar o agrupamento separadamente
 * pra "explicar" o número já calculado seria recriar o problema que motivou esta função).
 */
export interface ItemDetalheContagem {
  item: ItemProducao;
  /** Posição do item no array `itens` de entrada de `detalharContagemGuias` (o array completo,
   *  incluindo os inválidos) — permite reconstruir a ordem original sem re-filtrar. */
  indiceOriginal: number;
  ramo: RamoContagem;
  /** Chave usada no agrupamento: paciente (`pacienteNome`) ou senha (`atendimentoExternoId`)
   *  conforme `chaveAgrupamento3x1`/`chaveAtendimento`. Informativo mesmo quando o ramo não
   *  agrupa de fato (ex.: 'outros' fora de especialidade 3x1 — cada item é seu próprio grupo). */
  chaveAgrupamento: string;
  /** Identifica o grupo de forma estável — dois itens com o mesmo `grupoId` foram somados na
   *  MESMA guia. Exceção nunca compartilha `grupoId` entre itens, mesmo com paciente/data/código
   *  idênticos (cada ocorrência é 1 guia individual, GATE 2026-08-06). */
  grupoId: string;
  /** 1-based, ordem de PRIMEIRA OCORRÊNCIA do grupo dentro do ramo — determinístico (mesma
   *  entrada sempre produz a mesma sequência), usado pra cor cíclica na planilha de auditoria.
   *  NÃO é o número da guia cobrada (vários grupos podem gerar mais de 1 guia cada). */
  grupoSequencia: number;
  /** Quantas guias o grupo deste item gerou no total: `Math.ceil(count/3)` para um grupo 3x1,
   *  sempre 1 para exceção ou para um item sem agrupamento real (ramo 'outros' fora de
   *  especialidade 3x1). Idêntico pra todo item do mesmo `grupoId`. */
  guiasDoGrupo: number;
}

/** Saída completa de `detalharContagemGuias` — `guias`/`cirurgias` são IDÊNTICOS ao que
 *  `contarGuiasProducao` sempre devolveu (ver wrapper abaixo). */
export interface DetalheContagem {
  itensDetalhados: ItemDetalheContagem[];
  itensInvalidos: ItemProducao[];
  guias: number;
  cirurgias: number;
}

/**
 * Núcleo do agrupamento 3x1 — mesma lógica que `contarGuiasProducao` sempre teve (ver a extensa
 * doc acima desta função, preservada), só que expondo o detalhe por item em vez de descartá-lo
 * depois de somar. `contarGuiasProducao` é hoje só um wrapper que soma este detalhe (ver abaixo).
 */
export function detalharContagemGuias(itens: ItemProducao[], especialidade?: string | null): DetalheContagem {
  const comIndice = itens.map((item, indiceOriginal) => ({ item, indiceOriginal }));
  const validos = comIndice.filter((e) => ehItemValido(e.item));
  const itensInvalidos = comIndice.filter((e) => !ehItemValido(e.item)).map((e) => e.item);

  const usaTeto3x1 = usaRegra3x1(especialidade);

  // Mesma separação de exceção ANTES de dividir por viaAcesso (GATE 2026-08-06) — ver doc de
  // `contarGuiasProducao` original.
  const itensExcecao = validos.filter((e) => ehExcecao(e.item, especialidade));
  const itensParaContagem = validos.filter((e) => !ehExcecao(e.item, especialidade));

  const viaAcessoItems = itensParaContagem.filter((e) => e.item.viaAcesso);
  const outrosItems = itensParaContagem.filter((e) => !e.item.viaAcesso);

  const itensDetalhados: ItemDetalheContagem[] = [];
  const sequenciaPorRamo: Record<RamoContagem, number> = { excecao: 0, viaAcesso: 0, outros: 0 };
  const grupoSequenciaMemo = new Map<string, number>();
  function sequenciaDoGrupo(ramo: RamoContagem, grupoId: string): number {
    const memo = grupoSequenciaMemo.get(grupoId);
    if (memo != null) return memo;
    sequenciaPorRamo[ramo] += 1;
    grupoSequenciaMemo.set(grupoId, sequenciaPorRamo[ramo]);
    return sequenciaPorRamo[ramo];
  }

  // Exceção: cada ocorrência é 1 guia cheia e individual — grupo próprio, nunca compartilhado.
  for (const { item, indiceOriginal } of itensExcecao) {
    const grupoId = `excecao|${indiceOriginal}`;
    itensDetalhados.push({
      item,
      indiceOriginal,
      ramo: 'excecao',
      chaveAgrupamento: item.pacienteNome,
      grupoId,
      grupoSequencia: sequenciaDoGrupo('excecao', grupoId),
      guiasDoGrupo: 1,
    });
  }

  // viaAcesso e outros usam a MESMA função — o que muda é só a chave/fórmula de agrupamento,
  // decidida por `usaTeto3x1` (idêntico às duas ramificações if/else que `contarGuiasProducao`
  // sempre teve, uma pra cada ramo).
  function processarRamo(ramoItens: typeof viaAcessoItems, ramo: 'viaAcesso' | 'outros'): void {
    if (usaTeto3x1) {
      // Especialidade 3x1: teto(qtd/3) por (chaveAgrupamento3x1, data).
      const chaveFn = chaveAgrupamento3x1(ramoItens.map((e) => e.item));
      const porGrupo = new Map<string, typeof ramoItens>();
      for (const entry of ramoItens) {
        const grupoId = `${ramo}|${chaveFn(entry.item)}|${entry.item.data}`;
        const lista = porGrupo.get(grupoId);
        if (lista) lista.push(entry);
        else porGrupo.set(grupoId, [entry]);
      }
      for (const [grupoId, entries] of porGrupo) {
        const guiasDoGrupo = Math.ceil(entries.length / 3);
        const seq = sequenciaDoGrupo(ramo, grupoId);
        const chave = chaveFn(entries[0]!.item);
        for (const { item, indiceOriginal } of entries) {
          itensDetalhados.push({ item, indiceOriginal, ramo, chaveAgrupamento: chave, grupoId, grupoSequencia: seq, guiasDoGrupo });
        }
      }
    } else if (ramo === 'viaAcesso') {
      // Nenhuma especialidade 3x1: via de acesso agrupa por chaveAtendimento — 1 guia por GRUPO
      // (não por item), comportamento original preservado.
      const porGrupo = new Map<string, typeof ramoItens>();
      for (const entry of ramoItens) {
        const grupoId = `${ramo}|${chaveAtendimento(entry.item)}`;
        const lista = porGrupo.get(grupoId);
        if (lista) lista.push(entry);
        else porGrupo.set(grupoId, [entry]);
      }
      for (const [grupoId, entries] of porGrupo) {
        const seq = sequenciaDoGrupo(ramo, grupoId);
        const chave = chaveAtendimento(entries[0]!.item);
        for (const { item, indiceOriginal } of entries) {
          itensDetalhados.push({ item, indiceOriginal, ramo, chaveAgrupamento: chave, grupoId, grupoSequencia: seq, guiasDoGrupo: 1 });
        }
      }
    } else {
      // Nenhuma especialidade 3x1: 'outros' é 1 guia por ITEM, sem agrupamento nenhum —
      // `chaveAgrupamento` aqui é só informativo (não afeta a contagem).
      for (const { item, indiceOriginal } of ramoItens) {
        const grupoId = `${ramo}|${indiceOriginal}`;
        itensDetalhados.push({
          item,
          indiceOriginal,
          ramo,
          chaveAgrupamento: chaveAtendimento(item),
          grupoId,
          grupoSequencia: sequenciaDoGrupo(ramo, grupoId),
          guiasDoGrupo: 1,
        });
      }
    }
  }
  processarRamo(viaAcessoItems, 'viaAcesso');
  processarRamo(outrosItems, 'outros');

  // Cirurgias: quantidade de chaves de atendimento únicas (PRD §12) — métrica informativa,
  // independente da regra de guias acima. Inclui itens de exceção (é contagem de atendimento,
  // não de guia cobrada).
  const gruposAtendimento = new Set<string>();
  for (const { item } of validos) {
    gruposAtendimento.add(chaveAtendimento(item));
  }
  let cirurgias = 0;
  if (usaTeto3x1 || viaAcessoItems.length > 0) {
    cirurgias = gruposAtendimento.size;
  }

  // guias: soma de `guiasDoGrupo` por grupoId ÚNICO (nunca por item — vários itens do mesmo
  // grupo compartilham o mesmo guiasDoGrupo, somar por item duplicaria).
  const guiasPorGrupo = new Map<string, number>();
  for (const d of itensDetalhados) {
    if (!guiasPorGrupo.has(d.grupoId)) guiasPorGrupo.set(d.grupoId, d.guiasDoGrupo);
  }
  let guias = 0;
  for (const g of guiasPorGrupo.values()) guias += g;

  return { itensDetalhados, itensInvalidos, guias, cirurgias };
}

export function contarGuiasProducao(itens: ItemProducao[], especialidade?: string | null): ResultadoContagem {
  const { guias, cirurgias } = detalharContagemGuias(itens, especialidade);
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
 * Detecta angiologista pelo prefixo "angiolog" (Angiologia/Angiologista, case-insensitive) —
 * mesmo padrão das demais. GATE 2026-08-07: especialidade SEM lote principal — a produção
 * inteira vem de 3 lotes próprios (Cateter, Fístula, Angiografia — ver `processarMedico`),
 * cada um com regra de contagem diferente. `isAngiologista` por si só só importa pro lote de
 * Angiografia, que usa o MESMO teto(n/3) das outras especialidades 3x1 (Cateter/Fístula são
 * sempre 1x1, contados fora do Engine de agrupamento — ver `processar-medico.ts`).
 */
export function isAngiologista(especialidade?: string | null): boolean {
  if (!especialidade) return false;
  return especialidade.toLowerCase().includes('angiolog');
}

/**
 * Especialidades que usam o teto(n/3) por atendimento em vez de 1 guia por procedimento (PRD
 * §12; GATE 2026-08-06 ampliando de pediatra/urologista para ginecologista/ortopedista, GATE
 * 2026-08-07 ampliando pro lote de Angiografia do angiologista).
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
    isOrtopedista(especialidade) ||
    isAngiologista(especialidade)
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
 * Normaliza um código de procedimento pra só dígitos — resolve a divergência de formato entre
 * a notação TUSS documentada ("3.11.02.03-4", usada na constante acima, mais legível/
 * auditável) e o que a API real do sistema web efetivamente manda em `proc_code`: dígitos
 * puros, sem pontuação ("31102034"). BUG REAL 2026-08-06 (achado durante a implementação da
 * exceção do ginecologista): comparar os dois formatos direto NUNCA batia — nenhuma exceção
 * era reconhecida. Mesmo bug provavelmente afeta CODIGOS_EXCECAO_UROLOGISTA desde a
 * implementação original (mesma API, mesmo campo `proc_code`) — nunca confirmado porque não
 * havia caso real de exceção de urologista auditado até agora.
 */
function normalizarCodigo(codigo: string): string {
  return codigo.replace(/\D/g, '');
}

const CODIGOS_EXCECAO_UROLOGISTA_NORM: ReadonlySet<string> = new Set(
  [...CODIGOS_EXCECAO_UROLOGISTA].map(normalizarCodigo),
);

/**
 * Código TUSS excluído do pool 3x1 do lote de Angiografia do angiologista (GATE 2026-08-07):
 * dentro do "pacote angiografia" (3 angiografias = 1 guia), o Intra-operatório nunca entra no
 * agrupamento — cada ocorrência é 1 guia cheia e individual, mesmo mecanismo do urologista
 * (aliás o MESMO código — `4.09.02.05-6` já era exceção pro urologista; aqui ganha uma
 * constante própria, não reaproveita `CODIGOS_EXCECAO_UROLOGISTA`, pra não acoplar as duas
 * especialidades — se uma lista mudar no futuro, a outra não é afetada por engano). Confirmado
 * pelo usuário: nenhum outro código além deste é exceção dentro do pacote de angiografia.
 */
export const CODIGOS_EXCECAO_ANGIOGRAFIA: ReadonlySet<string> = new Set([
  '4.09.02.05-6', // Intra-operatório
]);
const CODIGOS_EXCECAO_ANGIOGRAFIA_NORM: ReadonlySet<string> = new Set(
  [...CODIGOS_EXCECAO_ANGIOGRAFIA].map(normalizarCodigo),
);

/**
 * "diu" como PALAVRA, não como substring (auditoria 2026-09-02): `includes('diu')` casava dentro
 * de "DIURESE"/"CONTROLE DE DIURESE"/"DIURÉTICO", e cada falso positivo errava DUAS vezes — tirava
 * o item do pool 3x1 E somava 1 guia cheia extra. Continua pegando as grafias reais, onde "DIU"
 * aparece isolado ou entre parênteses ("...INTRA-UTERINO (DIU)", "DIU DE COBRE").
 */
const DIU_PALAVRA_ISOLADA = /\bdiu\b/;

/**
 * Ginecologista: exceção por DESCRIÇÃO do procedimento, não por código fixo (GATE 2026-08-07,
 * correção da coordenadora financeira sobre o pedido original — ela tinha dito "histerectomia"
 * mas era "histeroscopia"). Motivo de usar descrição em vez de uma lista de códigos (como o
 * urologista): nos dados reais do Dr. Márcio Erlon Fontinele Moreira existem 5 códigos TUSS
 * DIFERENTES só pra "IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)" (inserção/remoção/hormonal/
 * não hormonal, todos com a MESMA descrição genérica na origem) — uma lista fechada de códigos
 * quebraria a cada variação nova. Contém "diu" OU "histeroscopia" (case-insensitive, qualquer
 * subtipo — não diferencia inserção/remoção/hormonal nem cirúrgica/diagnóstica, confirmado pelo
 * usuário). Histerectomia NÃO é exceção — entra no pool 3x1 normal como qualquer outra cirurgia.
 */
function ehExcecaoGinecologistaPorDescricao(descricao: string | null | undefined): boolean {
  if (!descricao) return false;
  const d = descricao.toLowerCase();
  return DIU_PALAVRA_ISOLADA.test(d) || d.includes('histeroscopia');
}

/**
 * Decide se um item é exceção (fora do pool 3x1, 1 guia cheia e individual) pra especialidade
 * do médico. Urologista compara por CÓDIGO (lista fechada, `CODIGOS_EXCECAO_UROLOGISTA`);
 * ginecologista compara por DESCRIÇÃO (`ehExcecaoGinecologistaPorDescricao`) — mecanismos
 * DIFERENTES por especialidade, cada um no formato que se provou robusto pro caso real dela.
 * Pediatra/ortopedista/nenhuma 3x1 nunca têm exceção (ortopedista usa 3x1 mas SEM exceção,
 * pedido explícito do dono, GATE 2026-08-06).
 *
 * PRECEDÊNCIA (não especificada pelo usuário, decisão de implementação): se a especialidade
 * cadastrada bater com UROLOGISTA e GINECOLOGISTA ao mesmo tempo (texto composto, ex.:
 * hipotético "Ginecologia e Urologia" — sem caso real conhecido na base hoje, mas
 * "Cirurgião Geral / Urologista" já mostrou que textos compostos acontecem), urologista tem
 * prioridade — a regra do ginecologista nem chega a ser avaliada. Se aparecer um médico real
 * nesse caso, resolver explicitamente em vez de depender desta ordem implícita de `if`.
 */
function ehExcecao(item: ItemProducao, especialidade?: string | null): boolean {
  if (isUrologista(especialidade)) {
    return CODIGOS_EXCECAO_UROLOGISTA_NORM.has(normalizarCodigo(item.codigoProcedimento ?? ''));
  }
  if (isGinecologista(especialidade)) {
    return ehExcecaoGinecologistaPorDescricao(item.descricaoProcedimento);
  }
  if (isAngiologista(especialidade)) {
    return CODIGOS_EXCECAO_ANGIOGRAFIA_NORM.has(normalizarCodigo(item.codigoProcedimento ?? ''));
  }
  return false;
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

  // Mesma exceção de contarGuiasProducao (GATE 2026-08-06): consolidado segue a MESMA regra
  // completa do valor real cobrado, pra não ficar um número informativo divergente.
  const itensExcecao = validos.filter((i) => ehExcecao(i, especialidade));
  const itensParaContagem = validos.filter((i) => !ehExcecao(i, especialidade));

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
