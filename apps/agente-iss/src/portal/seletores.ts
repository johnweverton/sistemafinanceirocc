// TODOS os seletores do portal ISS Fortaleza num lugar só (portal mudou → mexe só aqui).
// Origem: gravação real do portal em 2026-09-21 (RichFaces 3.3.3 / Keycloak), não suposição —
// ver tests/fixtures (HTML real anonimizado) e tests/seletores.test.ts, que prova que cada
// seletor casa com a estrutura real.
//
// Ids do JSF têm ':' — por isso seletores de atributo ([id="a:b"]) em vez de #a\:b.
// Ids "j_idNNN" são gerados e mudam entre telas: nunca usados aqui.

export const URL_BASE = 'https://iss.fortaleza.ce.gov.br';
export const URL_LOGIN = `${URL_BASE}/grpfor/login.seam`;
export const URL_HOME = `${URL_BASE}/grpfor/home.seam`;
export const HOST_IDP = 'idp2.sefin.fortaleza.ce.gov.br';

export const S = {
  login: {
    botaoFazerLogin: 'a[href="/grpfor/oauth2/login"]',
    usuario: '#username',
    senha: '#password',
    entrar: '#botao-entrar',
    erro: '.login-error-msg',
  },

  /** Cabeçalho presente em todas as telas logadas. */
  cabecalho: {
    inscricaoAtual: '[id$=":idInscricaoAtualTooltip"]',
    botaoTrocarInscricao: 'a[title="Alterar Inscrição Atual"]',
  },

  /** Modal "SELECIONE INSCRIÇÃO" (form alteraInscricaoForm). */
  inscricao: {
    campoPesquisa: '[id="alteraInscricaoForm:cpfPesquisa"]',
    radioCpf: '[id="alteraInscricaoForm:tipoPesquisa:0"]',
    radioCnpj: '[id="alteraInscricaoForm:tipoPesquisa:1"]',
    botaoPesquisar: '[id="alteraInscricaoForm:btnPesquisar"]',
    tabela: '[id="alteraInscricaoForm:empresaDataTable"]',
    linhas: '[id="alteraInscricaoForm:empresaDataTable:tb"] > tr',
    /** Dentro de uma linha: */
    linkSelecionar: '[id$=":linkImagem"]',
    linkDocumento: '[id$=":linkDocumento"]',
    linkInscricao: '[id$=":linkInscricao"]',
    linkNome: '[id$=":linkNome"]',
    /** Paginador (datascroller): botão "próxima" habilitado. */
    proximaPagina: '[id="alteraInscricaoForm:empresaDataTable"] tfoot td.rich-datascr-button[onclick*="\'next\'"]',
    /** Confirmação "A operação atual será abortada…" → Sim. */
    confirmarSim: '[id="alteraInscricaoForm:botaoOk"]',
  },

  /** Menu superior: Escrituração → Manter Escrituração. */
  menu: {
    grupoEscrituracao: 'a.dropdown-toggle',
    itensEscrituracao: '[id^="formMenuTopo:menuEscrituracao:"]',
    textoManterEscrituracao: 'Manter Escrituração',
  },

  /** Tela Manter Escrituração (form manterEscrituracaoForm). */
  escrituracao: {
    form: '[id="manterEscrituracaoForm"]',
    calendarioDe: 'manterEscrituracaoForm:dataInicial',
    calendarioAte: 'manterEscrituracaoForm:dataFinal',
    valorDe: '[id="manterEscrituracaoForm:dataInicialInputDate"]',
    valorAte: '[id="manterEscrituracaoForm:dataFinalInputDate"]',
    botaoConsultar: '[id="manterEscrituracaoForm:btnConsultar"]',
    competencias: '[id^="manterEscrituracaoForm:dataTable:"][id$=":textoCompetencia"]',
    situacao: (n: number) => `[id="manterEscrituracaoForm:dataTable:${n}:textoSituacao"]`,
    /** Só o link de VISUALIZAR — Escriturar/Reabrir/Exportar da mesma linha nunca são tocados. */
    linkVisualizar: (n: number) =>
      `[id="manterEscrituracaoForm:dataTable:${n}:visualizar"] a[title="Visualizar Escrituração"]`,
  },

  /** Tela Visualização da escrituração. */
  visualizacao: {
    dataCompetencia: '#dataCompentencia', // grafia do portal ("Compentencia")
    tabelaServicosPrestados: '[id="abaEncerramentoForm:dataTableServicosPrestados"]',
    cabecalhoServicosPrestados: '[id="abaEncerramentoForm:dataTableServicosPrestados"] > thead th',
    rodapeServicosPrestados: '[id="abaEncerramentoForm:dataTableServicosPrestados"] > tfoot td',
  },

  /** Cabeçalho de qualquer modal RichFaces visível (para detectar comunicados). */
  cabecalhoModal: '.rich-mpnl-header',
} as const;
