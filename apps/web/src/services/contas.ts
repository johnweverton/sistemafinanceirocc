// Service de contas emissoras — saldo por empresa para o dashboard.
import type { SaldoEmpresa } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const contasService = {
  saldos: () => apiFetch<SaldoEmpresa[]>('/contas/saldo'),
};

export const contasQueryKeys = {
  saldos: () => ['contas', 'saldos'] as const,
};
