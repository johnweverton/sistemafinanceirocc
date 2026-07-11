// Service de contas emissoras (Story 8.3) — saldo por empresa para o dashboard (D5).
import type { SaldoEmpresa } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const contasService = {
  saldos: () => apiFetch<SaldoEmpresa[]>('/contas/saldo'),
};

export const contasQueryKeys = {
  saldos: () => ['contas', 'saldos'] as const,
};
