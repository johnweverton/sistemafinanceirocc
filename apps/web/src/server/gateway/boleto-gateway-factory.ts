// Factory de BoletoGateway — devolve Cora (real, mTLS) ou Mock conforme BOLETO_GATEWAY env var.
// Trocar de provedor não exige redesenho: crie a nova classe implementando BoletoGatewayPort
// e registre aqui.
import type { BoletoGatewayPort, GatewayBoleto } from '@cobranca/shared';
import { getServerEnv } from '@/lib/env';
import { MockGateway } from './mock-gateway';
import { CoraGateway } from './cora-gateway';

/**
 * Retorna a implementação correta de BoletoGatewayPort com base em BOLETO_GATEWAY.
 * Também retorna o nome do gateway para persistir na tabela de auditoria.
 */
export function criarBoletoGateway(): { gateway: BoletoGatewayPort; nome: GatewayBoleto } {
  const { BOLETO_GATEWAY, MOCK_INVOICE_STATUS } = getServerEnv();
  if (BOLETO_GATEWAY === 'cora') {
    return { gateway: new CoraGateway(), nome: 'cora' };
  }
  // Débito M-1 (Story 6.1): status da reconsulta configurável — 'paid' (default) testa o fluxo
  // do webhook; MOCK_INVOICE_STATUS=open permite testar cancelamento em dev sem baixa falsa.
  return {
    gateway: new MockGateway({ status: MOCK_INVOICE_STATUS, valorPago: null, pagoEm: null }),
    nome: 'mock',
  };
}
