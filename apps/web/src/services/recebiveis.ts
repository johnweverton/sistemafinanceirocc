import type { Recebivel, FiltroRecebiveis } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const recebiveisService = {
  listar: (filtros: FiltroRecebiveis = {}) => {
    const qs = new URLSearchParams();
    if (filtros.competencia) qs.set('competencia', filtros.competencia);
    if (filtros.medicoId) qs.set('medico', filtros.medicoId);
    if (filtros.statusDerivado) qs.set('status', filtros.statusDerivado);
    if (filtros.contaEmissora) qs.set('conta', filtros.contaEmissora);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<Recebivel[]>(`/recebiveis${suffix}`);
  },
};

export const recebiveisQueryKeys = {
  recebiveis: (filtros: FiltroRecebiveis = {}) => ['recebiveis', filtros] as const,
};
