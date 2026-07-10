import type { Boleto } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const boletosService = {
  emitir: (execucaoResultadoId: string) =>
    apiFetch<{ boleto: Boleto }>('/boletos/emitir', {
      method: 'POST',
      body: JSON.stringify({ execucaoResultadoId }),
    }),
  reenviar: (execucaoResultadoId: string) =>
    apiFetch<{ message: string }>(`/execucoes/resultados/${execucaoResultadoId}/reenviar_boleto`, {
      method: 'POST',
    }),
  // Cancelamento ativo (Story 6.1) — motivo obrigatório; boleto pago não cancela.
  cancelar: (boletoId: string, motivo: string) =>
    apiFetch<{ boleto: Boleto }>(`/boletos/${boletoId}/cancelar`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    }),
  // URL do PDF do boleto (bank_slip da Cora) — para visualizar/baixar e reenviar manualmente.
  pdf: (boletoId: string) =>
    apiFetch<{ url: string; digitable: string | null }>(`/boletos/${boletoId}/pdf`),
};

/** Rótulos amigáveis para os campos de `details.faltantes` do erro 422 COBRANCA_INCOMPLETA. */
export const CAMPO_COBRANCA_LABEL: Record<string, string> = {
  pagadorTipo: 'tipo de pagador (PF/PJ)',
  pagadorDocumento: 'documento (CPF/CNPJ)',
  pagadorNome: 'nome/razão social',
  email: 'e-mail',
  cep: 'CEP',
  logradouro: 'logradouro',
  numero: 'número',
  bairro: 'bairro',
  cidade: 'cidade',
  uf: 'UF',
};
