import type { ResumoCompetencia, ResumoMedico, AgingFaixa } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

function comp(competencia?: string): string {
  return competencia ? `?competencia=${encodeURIComponent(competencia)}` : '';
}

export const dashboardService = {
  competencias: (competencia?: string) =>
    apiFetch<ResumoCompetencia[]>(`/dashboard/competencias${comp(competencia)}`),
  medicos: (competencia?: string) => apiFetch<ResumoMedico[]>(`/dashboard/medicos${comp(competencia)}`),
  aging: (competencia?: string) => apiFetch<AgingFaixa[]>(`/dashboard/aging${comp(competencia)}`),
};

export const dashboardQueryKeys = {
  competencias: () => ['dashboard', 'competencias'] as const,
  medicos: (competencia?: string) => ['dashboard', 'medicos', competencia ?? null] as const,
  aging: (competencia?: string) => ['dashboard', 'aging', competencia ?? null] as const,
};
