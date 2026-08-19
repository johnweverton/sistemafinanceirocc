import type { ResumoCompetencia, ResumoMedico, ResumoPorTipoServico, AgingFaixa, ContaEmissora, TipoServico } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

function qs(competencia?: string, contaEmissora?: ContaEmissora, tipoServico?: TipoServico): string {
  const params = new URLSearchParams();
  if (competencia) params.set('competencia', competencia);
  if (contaEmissora) params.set('contaEmissora', contaEmissora);
  if (tipoServico) params.set('tipoServico', tipoServico);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const dashboardService = {
  competencias: (competencia?: string, contaEmissora?: ContaEmissora, tipoServico?: TipoServico) =>
    apiFetch<ResumoCompetencia[]>(`/dashboard/competencias${qs(competencia, contaEmissora, tipoServico)}`),
  medicos: (competencia?: string, contaEmissora?: ContaEmissora, tipoServico?: TipoServico) =>
    apiFetch<ResumoMedico[]>(`/dashboard/medicos${qs(competencia, contaEmissora, tipoServico)}`),
  aging: (competencia?: string, contaEmissora?: ContaEmissora, tipoServico?: TipoServico) =>
    apiFetch<AgingFaixa[]>(`/dashboard/aging${qs(competencia, contaEmissora, tipoServico)}`),
  tipoServico: (competencia?: string) =>
    apiFetch<ResumoPorTipoServico[]>(`/dashboard/tipo-servico${qs(competencia)}`),
};

export const dashboardQueryKeys = {
  competencias: (contaEmissora?: ContaEmissora, tipoServico?: TipoServico) =>
    ['dashboard', 'competencias', contaEmissora ?? null, tipoServico ?? null] as const,
  medicos: (competencia?: string, contaEmissora?: ContaEmissora, tipoServico?: TipoServico) =>
    ['dashboard', 'medicos', competencia ?? null, contaEmissora ?? null, tipoServico ?? null] as const,
  aging: (competencia?: string, contaEmissora?: ContaEmissora, tipoServico?: TipoServico) =>
    ['dashboard', 'aging', competencia ?? null, contaEmissora ?? null, tipoServico ?? null] as const,
  tipoServico: (competencia?: string) => ['dashboard', 'tipoServico', competencia ?? null] as const,
};
