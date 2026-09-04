import type {
  Execucao,
  ExecucaoResultado,
  ExecucaoResultadoContribuicao,
  ExecucaoResumoMedico,
  ExecucaoHistoricoMedicoItem,
  Medico,
  LoteExterna,
} from '@cobranca/shared';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';
import { baixarArquivo } from '@/lib/baixar-arquivo';

export interface ExecucaoSelecaoPayload {
  medicoId: string;
  /** Null pra médico Angiologista (GATE 2026-08-07) — sem lote principal. */
  producaoExternaId: string | null;
  producaoNome: string | null;
  /** Produção de consultas de pediatria — opcional. Flat (fin-producoes). */
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
  /** Sub-lote(s) de consultas de pediatria (achado 2026-08-21) — mutuamente exclusivo com
   * `producaoConsultasExternaId`. Usado quando a produção mensal do pediatra tem a mesma
   * estrutura de sub-lotes do Angiologista (fin-lotes). Sempre acompanhado de
   * `producaoGuiasLoteExternaIds` (os demais sub-lotes, guia principal). */
  producaoConsultasLoteExternaIds?: string[] | null;
  producaoConsultasLoteNomes?: string[] | null;
  producaoGuiasLoteExternaIds?: string[] | null;
  producaoGuiasLoteNomes?: string[] | null;
  /** Lotes separados de Outros Hospitais/Imobilizações — opcionais. */
  producaoOutrosHospitaisExternaId?: string | null;
  producaoOutrosHospitaisNome?: string | null;
  producaoImobilizacoesExternaId?: string | null;
  producaoImobilizacoesNome?: string | null;
  /** Sub-lotes de Imobilizações (achado 2026-08-25, virou ARRAY na migration 0059) — mutuamente
   * exclusivo com `producaoImobilizacoesExternaId`. Médico VH com Imobilizações pode ter a
   * produção mensal dividida em vários sub-lotes por dia/período, classificados automaticamente
   * pelo nome ("CIRURGIA*" → producaoGuiasLoteExternaIds, "IMOBILIZ*" → aqui) — todos somados. */
  producaoImobilizacoesLoteExternaIds?: string[] | null;
  producaoImobilizacoesLoteNomes?: string[] | null;
  /** Lotes de Cateter/Fístula/Angiografia (médico Angiologista, GATE 2026-08-07) — opcionais.
   * Arrays desde a migration 0046 (achado 2026-08-13): a origem divide cada categoria em
   * quinzenas (1Q/2Q) como sub-lotes separados — todos os selecionados são somados. */
  producaoCateterExternaIds?: string[] | null;
  producaoCateterNomes?: string[] | null;
  producaoFistulaExternaIds?: string[] | null;
  producaoFistulaNomes?: string[] | null;
  producaoAngiografiaExternaIds?: string[] | null;
  producaoAngiografiaNomes?: string[] | null;
  /** Carta de Rede (médico Angiologista, GATE 2026-08-12) — contagem MANUAL, sem itens da API. */
  producaoCartaRedeExternaId?: string | null;
  producaoCartaRedeNome?: string | null;
  cartaRedeGuias?: number | null;
  /** Total de guias do lote PRINCIPAL conferido MANUALMENTE pelo dono, vindo da planilha
   *  (migration 0058) — quando presente, o motor pula a contagem automática dessa classe pra
   *  este médico. `motivo` é obrigatório junto. */
  guiasManuaisTotal?: number | null;
  /** Mesmo mecanismo de `guiasManuaisTotal`, mas para o componente de Consultas do pediatra
   *  (achado 2026-09-04) — cada classe tem sua própria coluna na planilha, tabelas de preço
   *  diferentes não podem ser somadas num total só. */
  guiasManuaisConsultas?: number | null;
  /** Mesmo mecanismo acima, para o lote separado de Imobilizações. */
  guiasManuaisImobilizacoes?: number | null;
  /** Mesmo mecanismo acima, para o lote separado de Outros Hospitais. */
  guiasManuaisOutrosHospitais?: number | null;
  guiasManuaisMotivo?: string | null;
}

/** Uma linha da planilha de guias manuais já casada com um médico do cadastro (por CPF). Cada
 *  campo `guiasManuais*` é independente e opcional (achado 2026-09-04: guias normais, consultas,
 *  imobilizações e outros hospitais têm tabelas de preço diferentes, cada um com sua própria
 *  coluna na planilha) — `undefined` = aquela classe continua na contagem automática. */
export interface GuiasManuaisLinha {
  linha: number;
  medicoId: string;
  medicoNome: string;
  cpf: string;
  nomePlanilha: string;
  competencia: string;
  guiasManuaisTotal?: number;
  guiasManuaisConsultas?: number;
  guiasManuaisImobilizacoes?: number;
  guiasManuaisOutrosHospitais?: number;
  guiasManuaisMotivo: string;
}

/** Preview da planilha: o que casou e o que deu erro por linha — nada é gravado até o disparo. */
export interface GuiasManuaisPreview {
  linhas: GuiasManuaisLinha[];
  erros: { linha: number; chave: string; erro: string }[];
}

export interface ApoioData {
  medicos: Medico[];
  clientesOrigem: Array<{
    id: string;
    nome: string;
    producoes: Array<{ id: string; nome: string }>;
  }>;
}

export const execucoesService = {
  apoio: () => apiFetch<ApoioData>('/execucoes/apoio'),
  /**
   * Sub-lotes (Cateter/Fístula/Angiografia/Carta de Rede) dentro da produção MENSAL de um médico
   * Angiologista — endpoint aditivo da origem, buscado sob demanda (GATE 2026-08-13), nunca
   * pré-carregado em `apoio`.
   */
  lotes: (producaoId: string) =>
    apiFetch<{ lotes: LoteExterna[] }>(`/execucoes/lotes?producaoId=${producaoId}`),
  /**
   * `empresaId` marca a execução como agregada por empresa; `clienteContabilidadeId` marca como
   * execução de cliente contábil; `ehAdicional` marca como o boleto avulso do adicional
   * semestral (só válido com `clienteContabilidadeId`).
   */
  disparar: (
    competencia: string,
    selecoes: ExecucaoSelecaoPayload[],
    empresaId?: string,
    clienteContabilidadeId?: string,
    ehAdicional?: boolean,
  ) =>
    apiFetch<{ execucaoId: string }>('/execucoes', {
      method: 'POST',
      body: JSON.stringify({
        competencia,
        selecoes,
        ...(empresaId ? { empresaId } : {}),
        ...(clienteContabilidadeId ? { clienteContabilidadeId } : {}),
        ...(ehAdicional ? { ehAdicional } : {}),
      }),
    }),
  /**
   * Lê a planilha de guias conferidas MANUALMENTE (migration 0058) e devolve o preview resolvido
   * por CPF. Não grava nada nem dispara execução — o número só entra no cálculo quando o operador
   * confirma o disparo. FormData (não JSON), mesmo padrão de `medicosService.importar`.
   */
  previewGuiasManuais: async (arquivo: File, competencia: string): Promise<GuiasManuaisPreview> => {
    const form = new FormData();
    form.append('arquivo', arquivo);
    form.append('competencia', competencia);
    const res = await fetch('/api/execucoes/guias-manuais', { method: 'POST', body: form });
    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        /* corpo não-JSON */
      }
      throw new ApiClientError(
        res.status,
        body?.error?.message ?? `Erro ${res.status}`,
        body?.error?.code ?? 'ERROR',
      );
    }
    return res.json() as Promise<GuiasManuaisPreview>;
  },
  listar: () => apiFetch<Execucao[]>('/execucoes'),
  detalhe: (id: string) => apiFetch<Execucao>(`/execucoes/${id}`),
  /**
   * Processa (ou retoma) uma execução em "processando" — a rota aguarda o processamento terminar
   * antes de responder. Dois usos: o botão "Reprocessar" de uma execução travada, e o disparo do
   * cálculo logo após criar o lote de clientes contábeis (Story 12.5), já que
   * POST /clientes-contabilidade/lote só cria a execução e devolve o id.
   */
  retomar: (id: string) => apiFetch<{ ok: true }>(`/execucoes/${id}/retomar`, { method: 'POST' }),
  resultados: (id: string) => apiFetch<ExecucaoResultado[]>(`/execucoes/${id}/resultados`),
  /** Auditoria "qual médico contribuiu quanto" de um resultado agregado. */
  contribuicoes: (resultadoId: string) =>
    apiFetch<ExecucaoResultadoContribuicao[]>(`/execucoes/resultados/${resultadoId}/contribuicoes`),
  revisarResultado: (execucaoId: string, resultadoId: string, motivo: string) =>
    apiFetch<{ resultado: ExecucaoResultado }>(
      `/execucoes/${execucaoId}/resultados/${resultadoId}/revisar`,
      { method: 'POST', body: JSON.stringify({ motivo }) },
    ),
  /** Reprocessa um resultado já gravado com os itens de produção ATUAIS da origem — para quando
   *  o dado foi corrigido no sistema de origem depois que a execução já rodou. Bloqueado se o
   *  resultado já tiver boleto emitido. */
  recalcularResultado: (resultadoId: string) =>
    apiFetch<{ resultado: ExecucaoResultado }>(
      `/execucoes/resultados/${resultadoId}/recalcular`,
      { method: 'POST' },
    ),
  /** Auditoria visual da regra 3x1 (achado 2026-09-04) — planilha .xlsx com cada procedimento
   *  bruto marcado/colorido por qual "guia" (grupo de até 3) ele foi somado, pra conferência
   *  manual contra o valor cobrado. Sem a trava de boleto emitido do recálculo (só lê, nunca
   *  grava). */
  auditoria3x1: (resultadoId: string) => baixarArquivo(`/execucoes/resultados/${resultadoId}/auditoria-3x1`),
  resumoPorMedico: () => apiFetch<ExecucaoResumoMedico[]>('/execucoes/por-medico'),
  /** Médicos com boleto ativo (emitido/pago) já na competência informada, em qualquer execução
   *  — usado pra não deixar reemitir boleto duplicado do mesmo médico no mesmo mês. Sem cache
   *  (precisa refletir uma emissão feita há poucos segundos). */
  medicosComBoleto: (competencia: string) =>
    apiFetch<{ medicoIds: string[] }>(`/execucoes/medicos-com-boleto?competencia=${competencia}`),
  historicoMedico: (chave: { medicoId?: string; cpf?: string }) => {
    const qs = new URLSearchParams();
    if (chave.medicoId) qs.set('medicoId', chave.medicoId);
    else if (chave.cpf) qs.set('cpf', chave.cpf);
    return apiFetch<ExecucaoHistoricoMedicoItem[]>(`/execucoes/por-medico/historico?${qs}`);
  },
};

export const execucaoQueryKeys = {
  execucoes: () => ['execucoes'] as const,
  execucao: (id: string) => ['execucoes', id] as const,
  resultados: (id: string) => ['execucoes', id, 'resultados'] as const,
  contribuicoes: (resultadoId: string) => ['execucoes', 'resultados', resultadoId, 'contribuicoes'] as const,
  apoio: () => ['execucoes', 'apoio'] as const,
  lotes: (producaoId: string) => ['execucoes', 'lotes', producaoId] as const,
  medicosComBoleto: (competencia: string) => ['execucoes', 'medicos-com-boleto', competencia] as const,
  resumoPorMedico: () => ['execucoes', 'por-medico'] as const,
  historicoMedico: (chave: string) => ['execucoes', 'por-medico', 'historico', chave] as const,
};
