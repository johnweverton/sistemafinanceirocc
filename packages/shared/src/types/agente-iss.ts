// Domínio: agente de captura de faturamento no ISS Fortaleza (Story 13.1, Épico 13). Ver
// docs/architecture/feature-agente-faturamento-iss.md. O agente é um CLI local (Story 13.2) que
// fala com o sistema só por estas duas rotas (token dedicado, não service role — D2):
//   GET  /api/integracoes/iss/alvos      → AlvosIssResposta
//   POST /api/integracoes/iss/execucoes  → NovaExecucaoIss
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
