// Execução de uma competência e o resultado agregado por médico.
// Derivado da arquitetura (Data Models) e do PRD §7.

export type StatusExecucao = 'processando' | 'concluido' | 'erro';
/**
 * 'acumulado' (achado real 2026-08-13, regra da coordenadora financeira): médico com menos de 5
 * guias combinadas (todos os lotes, exceto consultas) na competência — NÃO gera boleto, a
 * produção fica retida em `medicos_saldo_acumulado` até somar com um mês futuro e bater o
 * limiar. `totalValor` sempre 0 nesse status; nunca elegível para emissão (mesma trava de
 * `status !== 'ok'` já usada em `emitir-boleto.ts`).
 */
export type StatusResultado = 'ok' | 'alerta' | 'sem_dados' | 'acumulado';

export type Classe =
  | 'HAPVIDA_CRED'
  | 'HAPVIDA_NAO_CRED'
  | 'OUTROS_HOSPITAIS'
  | 'IMOBILIZACOES';

export interface Subtotal {
  /**
   * Classe de preço, ou um marcador sintético que não entra em `TabelaPreco`:
   *   - 'PERCENTUAL_PRODUCAO' (Story 6.2): médico cobrado por percentual da produção.
   *   - 'PRECO_PROPRIO' (Story 10.1): médico com regra de preço própria fora de faixa.
   *   - 'CONSULTA_PEDIATRIA' (Story 10.2): componente ADITIVO de consultas ambulatoriais do
   *     pediatra — soma ao(s) subtotal(is) de guias, não os substitui (diferente dos dois acima).
   * Em todos os casos há um subtotal com a memória de cálculo em `faixa`.
   */
  classe: Classe | 'PERCENTUAL_PRODUCAO' | 'PRECO_PROPRIO' | 'CONSULTA_PEDIATRIA';
  guias: number;
  valor: number;
  faixa: string;
}

export interface Execucao {
  id: string;
  competencia: string; // AAAA-MM
  iniciadoPor: string;
  /** E-mail resolvido via Admin Auth API — undefined/null se não foi possível resolver (não-fatal). */
  iniciadoPorEmail?: string | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
  status: StatusExecucao;
  progresso: number; // 0-100
  totalMedicos: number | null;
  totalOk: number | null;
  totalAlerta: number | null;
  totalSemDados: number | null;
  /** Médicos com status 'acumulado' nesta execução (achado 2026-08-13) — produção retida, sem boleto. */
  totalAcumulado: number | null;
  totalGeralValor: number | null;
  /**
   * Marca esta execução como agregada por empresa (Story 10.4b) — soma a produção de vários
   * médicos num único resultado. Null/ausente = execução normal por médico (comportamento atual).
   */
  empresaId?: string | null;
  /**
   * Marca esta execução como sendo de um cliente contábil (Story 11.3) — processada sem lotes
   * (não há médicos/produção envolvidos). Mutuamente exclusivo com `empresaId`.
   */
  clienteContabilidadeId?: string | null;
  /**
   * Marca esta execução como o boleto avulso do adicional semestral (Story 11.4) — só válido
   * junto com `clienteContabilidadeId`. Default `false` = execução mensal normal.
   */
  ehAdicional?: boolean;
  /**
   * Nome do médico, só presente quando `totalMedicos === 1` (execução "pontual", disparada pelo
   * modo "Por médico" da tela Nova Emissão) — resolvido via join em `execucao_resultados` (busca
   * em lote no repositório, não N+1). null/undefined em execuções em massa ou ainda sem resultado
   * gravado. Usado só para busca por nome na tela de Emissões (histórico).
   */
  medicoNome?: string | null;
}

export interface ExecucaoResultado {
  id: string;
  execucaoId: string;
  medicoId: string | null;
  cpf: string;
  nome: string;
  procedimentos: number | null;
  cirurgias: number | null;
  guias: number | null;
  guiasConsolidado: number | null;
  subtotais: Subtotal[] | null;
  totalValor: number | null;
  status: StatusResultado;
  alertas: string[];
  /** Status computado originalmente pelo engine — presente só quando o resultado foi revisado
   * manualmente (ex.: 'alerta' preservado enquanto `status` atual já é 'ok'). */
  statusOriginal?: StatusResultado | null;
  revisadoPor?: string | null;
  revisadoEm?: string | null;
  motivoRevisao?: string | null;
  /** Quem/quando disparou o último recálculo (migration 0041, achado 2026-08-04) — reprocessa os
   * itens de produção atuais da origem em cima da mesma linha, sem criar uma execução nova. */
  recalculadoPor?: string | null;
  recalculadoEm?: string | null;
  /** Status do envio do boleto via WhatsApp/Email (auditoria) */
  disparos?: {
    canal: 'whatsapp' | 'email';
    status: 'sucesso' | 'falha';
    mensagemErro: string | null;
    enviadoEm: string;
  }[];
  /**
   * Resultado AGREGADO de uma empresa (Story 10.4b) — soma da produção de vários médicos.
   * Mutuamente exclusivo com `medicoId` (nunca os dois setados), mas ambos podem ser null
   * (médico legado sem vínculo, identificado por `cpf`).
   */
  empresaId?: string | null;
  /**
   * Resultado de um cliente contábil (Story 11.3) — valor único, sem agregação. Mutuamente
   * exclusivo com `medicoId`/`empresaId` (constraint `chk_execucao_resultados_exclusao_mutua`).
   */
  clienteContabilidadeId?: string | null;
}

/**
 * Uma linha de auditoria "qual médico contribuiu quanto" para um resultado AGREGADO por
 * empresa (Story 10.4b) — não existe para resultados normais por médico.
 */
export interface ExecucaoResultadoContribuicao {
  id: string;
  execucaoResultadoId: string;
  medicoId: string;
  guias: number;
  valor: number;
  criadoEm: string;
}

export interface ExecucaoSelecao {
  execucaoId: string;
  medicoId: string;
  /**
   * Produção principal (guias normais/Hapvida). Nullable a partir do GATE 2026-08-07: médico
   * Angiologista não tem lote principal — a produção dele vem inteira de
   * producaoCateter/Fistula/AngiografiaExternaId abaixo. Pra qualquer outra especialidade
   * continua sendo preenchido sempre (nunca null na prática, só o tipo ficou mais permissivo).
   */
  producaoExternaId: string | null;
  producaoNome: string | null;
  /**
   * Produção separada com as consultas ambulatoriais do pediatra (Story 10.2) — opcional,
   * só relevante para médicos pediatras que têm um lote de consultas distinto do de guias
   * hospitalares no mês. Null/ausente = médico sem componente de consultas nesta execução.
   */
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
  /**
   * Produção separada com as guias de OUTROS_HOSPITAIS (Story 10.5) — opcional, só relevante
   * para médicos com `fazOutrosHospitais`. É um LOTE DISTINTO do de `producaoExternaId` (produção
   * normal/Hapvida): antes desta story o motor reaproveitava a MESMA contagem de guias do lote
   * principal para a tabela de OUTROS_HOSPITAIS, cobrando 2x a mesma produção em tabelas
   * diferentes (bug real — Dr. Marcel Rolim Queiroz). Null/ausente = médico com
   * `fazOutrosHospitais` mas sem o lote selecionado nesta execução → guias de Outros Hospitais
   * NÃO são cobradas (o motor nunca chuta, vira alerta explícito em vez de reaproveitar).
   */
  producaoOutrosHospitaisExternaId?: string | null;
  producaoOutrosHospitaisNome?: string | null;
  /** Mesmo mecanismo acima, para médicos com `fazImobilizacoes` (Story 10.5). */
  producaoImobilizacoesExternaId?: string | null;
  producaoImobilizacoesNome?: string | null;
  /**
   * Sub-lotes (fin-lotes.id) com as guias de CATETER (GATE 2026-08-07) — exclusiva de médicos
   * Angiologista, que não têm lote principal. ARRAY (migration 0046, achado 2026-08-13): a
   * origem divide cada categoria em quinzenas (1Q/2Q) como sub-lotes SEPARADOS — todos os ids
   * selecionados aqui têm seus itens somados antes de contar 1x1. Mesma semântica de
   * nunca-chuta de producaoOutrosHospitaisExternaId: array vazio/ausente = nenhum lote
   * selecionado, guias de Cateter NÃO são cobradas nesta execução.
   */
  producaoCateterExternaIds?: string[] | null;
  /** Snapshot dos nomes, mesma ordem de producaoCateterExternaIds. */
  producaoCateterNomes?: string[] | null;
  /** Mesmo mecanismo do Cateter acima — GATE 2026-08-07, array desde a migration 0046. */
  producaoFistulaExternaIds?: string[] | null;
  producaoFistulaNomes?: string[] | null;
  /** Mesmo mecanismo do Cateter acima — GATE 2026-08-07, array desde a migration 0046. */
  producaoAngiografiaExternaIds?: string[] | null;
  producaoAngiografiaNomes?: string[] | null;
}

/** Um médico por linha: ocorrência mais recente em qualquer execução (visão "Por médico"). */
export interface ExecucaoResumoMedico {
  medicoId: string | null; // null quando o médico não estava vinculado ao cadastro na execução
  cpf: string;
  nome: string;
  ultimaCompetencia: string;
  ultimaExecucaoId: string;
  ultimaExecucaoStatus: StatusExecucao;
  ultimoStatusResultado: StatusResultado;
  ultimoValor: number | null;
  qtdExecucoes: number;
}

/**
 * Uma ocorrência no histórico de um médico ao longo das competências (drill-down). Reaproveitado
 * tal como está pelo histórico de cliente contábil (Story 11.5) — nenhum campo é específico de
 * médico.
 */
export interface ExecucaoHistoricoMedicoItem {
  execucaoId: string;
  competencia: string;
  execucaoStatus: StatusExecucao;
  statusResultado: StatusResultado;
  totalValor: number | null;
  iniciadoEm: string;
  /** Adicional semestral (Story 11.4) — undefined/false = execução mensal normal. */
  ehAdicional?: boolean;
}
