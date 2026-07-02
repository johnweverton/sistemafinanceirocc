import type { ConfigCobranca } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const configCobrancaService = {
  ler: () => apiFetch<ConfigCobranca>('/config-cobranca'),
  atualizar: (config: ConfigCobranca) =>
    apiFetch<ConfigCobranca>('/config-cobranca', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};

export const configCobrancaQueryKeys = {
  config: () => ['config-cobranca'] as const,
};
