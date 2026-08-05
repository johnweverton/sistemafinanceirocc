import type { ResumoCompetencia, ResumoMedico, AgingFaixa, ContaEmissora } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

function qs(competencia?: string, contaEmissora?: ContaEmissora): string {
  const params = new URLSearchParams();
  if (competencia) params.set('competencia', competencia);
  if (contaEmissora) params.set('contaEmissora', contaEmissora);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const dashboardService = {
  competencias: (competencia?: string, contaEmissora?: ContaEmissora) =>
    apiFetch<ResumoCompetencia[]>(`/dashboard/competencias${qs(competencia, contaEmissora)}`),
  medicos: (competencia?: string, contaEmissora?: ContaEmissora) =>
    apiFetch<ResumoMedico[]>(`/dashboard/medicos${qs(competencia, contaEmissora)}`),
  aging: (competencia?: string, contaEmissora?: ContaEmissora) =>
    apiFetch<AgingFaixa[]>(`/dashboard/aging${qs(competencia, contaEmissora)}`),
};

export const dashboardQueryKeys = {
  competencias: (contaEmissora?: ContaEmissora) => ['dashboard', 'competencias', contaEmissora ?? null] as const,
  medicos: (competencia?: string, contaEmissora?: ContaEmissora) =>
    ['dashboard', 'medicos', competencia ?? null, contaEmissora ?? null] as const,
  aging: (competencia?: string, contaEmissora?: ContaEmissora) =>
    ['dashboard', 'aging', competencia ?? null, contaEmissora ?? null] as const,
};
