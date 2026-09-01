import type { ConfigLembreteVencimento } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const configLembreteVencimentoService = {
  ler: () => apiFetch<ConfigLembreteVencimento>('/config-lembrete-vencimento'),
  atualizar: (config: ConfigLembreteVencimento) =>
    apiFetch<ConfigLembreteVencimento>('/config-lembrete-vencimento', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};

export const configLembreteVencimentoQueryKeys = {
  config: () => ['config-lembrete-vencimento'] as const,
};
