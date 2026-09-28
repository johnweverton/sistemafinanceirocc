// Domínio: agente de captura de faturamento no ISS Fortaleza (Story 13.1, Épico 13). Ver
// docs/architecture/feature-agente-faturamento-iss.md. O agente é um CLI local (Story 13.2) que
// fala com o sistema só pelas rotas /api/integracoes/iss/* (token dedicado, não service role — D2):
//   GET  /api/integracoes/iss/alvos      → AlvosIssResposta
//   POST /api/integracoes/iss/execucoes  → NovaExecucaoIss
//   (+ as rotas de solicitações da Story 13.5, no fim deste arquivo)
// O que ele grava é PROPOSTA (decisão G3): o lançamento oficial continua sendo do operador.

/** De onde veio o número de um lançamento oficial de faturamento. */
export type OrigemFaturamento = 'manual' | 'iss_fortaleza';

/**
 * Resultado da leitura de UM cliente no portal:
 *   - 'capturado': achou a competência e leu o Somatório de Serviços Prestados;
 *   - 'nao_encontrado': o CNPJ não aparece no perfil MASTER (outro município, sem vínculo);
 *   - 'sem_escrituracao': empresa achada, competência inexistente — NÃO significa faturamento zero;
 *   - 'erro': tela inesperada, timeout ou guarda de sanidade (R1) falhou.
 */
export type StatusCapturaIss = 'capturado' | 'nao_encontrado' | 'sem_escrituracao' | 'erro';

/** Alerta de negócio anexado a uma captura (R5 da arquitetura). */
export type AlertaCapturaIss = 'possivel_nota_fora_escrituracao';

export interface AlvoIss {
  clienteContabilidadeId: string;
  nome: string;
  /** CPF (11) ou CNPJ (14), só dígitos — é por ele que o agente pesquisa no portal. */
  documento: string;
}

export interface AlvosIssResposta {
  competencia: string;
  alvos: AlvoIss[];
  /** Clientes `faixa_faturamento` ativos sem documento cadastrado — o agente não tem como achá-los. */
  semDocumento: { clienteContabilidadeId: string; nome: string }[];
}

export interface NovaCapturaIss {
  clienteContabilidadeId: string;
  status: StatusCapturaIss;
  /** Obrigatório (≥ 0) quando `status = 'capturado'`. */
  valorServicosPrestados: number | null;
  quantidadeNotas: number | null;
  situacaoIss: string | null;
  competenciaFechada: boolean | null;
  inscricaoMunicipal: string | null;
  razaoSocialIss: string | null;
  mensagemErro: string | null;
  capturadoEm: string;
}

/** Comunicado oficial em que o agente deu ciência em nome da empresa (decisão G2). */
export interface CienciaIss {
  documento: string;
  inscricaoMunicipal: string | null;
  assunto: string;
  dataComunicado: string | null;
  /** Caminho do PDF salvo na máquina do escritório. */
  arquivo: string;
  cienciaEm: string;
}

export interface NovaExecucaoIss {
  competencia: string;
  iniciadoEm: string;
  finalizadoEm: string | null;
  maquina: string | null;
  versaoAgente: string | null;
  capturas: NovaCapturaIss[];
  ciencias: CienciaIss[];
  /**
   * Story 13.5: solicitação `em_andamento` que esta execução atende (modo vigiar/agendado). É só
   * uma GUARDA de consistência — quem conclui a solicitação é `POST .../solicitacoes/{id}/concluir`.
   */
  solicitacaoId?: string;
  /**
   * QA 13.4/13.5: gerada UMA vez por execução pelo agente. Reenviar a mesma execução (resposta
   * perdida, reenvio automático) devolve a já gravada em vez de duplicar. Opcional: JSONs antigos
   * não têm.
   */
  chaveIdempotencia?: string;
}

export type TotaisExecucaoIss = Record<StatusCapturaIss, number>;

export interface ExecucaoIssRegistrada {
  execucaoId: string;
  competencia: string;
  totais: TotaisExecucaoIss;
  /** Quantas capturas saíram com algum alerta (R5). */
  comAlerta: number;
}

export interface CapturaIss extends Omit<NovaCapturaIss, 'capturadoEm'> {
  id: string;
  execucaoId: string;
  competencia: string;
  alertas: AlertaCapturaIss[];
  capturadoEm: string;
}

/** Limite de capturas por POST — bem acima da carteira atual (~90 empresas no perfil MASTER). */
export const AGENTE_ISS_MAX_CAPTURAS = 500;

/** Resumo da execução mais recente do agente numa competência (faixa-resumo da UI — Story 13.3). */
export interface UltimaExecucaoIss {
  id: string;
  competencia: string;
  iniciadoEm: string;
  finalizadoEm: string | null;
  totais: TotaisExecucaoIss;
}

/**
 * O que o diálogo de lote precisa para pré-preencher o faturamento (Story 13.3):
 * a proposta vigente por cliente, a última execução e o que já foi LANÇADO (com valor, para a
 * divergência da R4 — "lançado R$ X · ISS R$ Y").
 */
export interface PropostasIssResposta {
  competencia: string;
  propostas: CapturaIss[];
  ultimaExecucao: UltimaExecucaoIss | null;
  lancados: { clienteContabilidadeId: string; faturamento: number }[];
}

// ---------------------------------------------------------------------------------------------
// Story 13.5 (Fase 2): solicitações de busca feitas pelo sistema web. O operador pede a busca no
// diálogo de lote; o agente local (vigiando ou agendado) a reivindica e relata o progresso:
//   GET  /api/integracoes/iss/solicitacoes/proxima          → SolicitacaoIss (204 se nada a fazer)
//   POST /api/integracoes/iss/solicitacoes/{id}/progresso   ← { atual, total }
//   POST /api/integracoes/iss/solicitacoes/{id}/concluir    ← { execucaoId } | { erro }
// A senha do ISS continua só na máquina do escritório (G4) — nada disso a transporta.
// ---------------------------------------------------------------------------------------------

export type StatusSolicitacaoIss = 'pendente' | 'em_andamento' | 'concluida' | 'falhou' | 'cancelada';

/** Status em que a solicitação ainda ocupa a competência (índice único parcial da 0062). */
export const STATUS_SOLICITACAO_ISS_ATIVOS: readonly StatusSolicitacaoIss[] = ['pendente', 'em_andamento'];

/** Espelho da tabela `iss_solicitacoes` (migration 0062), em camelCase. */
export interface SolicitacaoIss {
  id: string;
  competencia: string;
  /** `null` = carteira inteira de `faixa_faturamento`; preenchido = só estes CPF/CNPJ. */
  documentos: string[] | null;
  status: StatusSolicitacaoIss;
  solicitadoPor: string;
  solicitadoEm: string;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  progressoAtual: number | null;
  progressoTotal: number | null;
  execucaoId: string | null;
  mensagemErro: string | null;
  maquina: string | null;
  heartbeatEm: string | null;
}

/** Corpo de `POST .../solicitacoes/{id}/concluir`: sucesso XOR falha. */
export type ConclusaoSolicitacaoIss = { execucaoId: string } | { erro: string };
