import type { ConfigRelatorioMensal } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const configRelatorioMensalService = {
  ler: () => apiFetch<ConfigRelatorioMensal>('/config-relatorio-mensal'),
  atualizar: (config: ConfigRelatorioMensal) =>
    apiFetch<ConfigRelatorioMensal>('/config-relatorio-mensal', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};

export const configRelatorioMensalQueryKeys = {
  config: () => ['config-relatorio-mensal'] as const,
};
