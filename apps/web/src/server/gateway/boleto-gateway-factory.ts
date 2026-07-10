// Factory de BoletoGateway — devolve Cora (real, mTLS) ou Mock conforme BOLETO_GATEWAY env var.
// Multi-conta (Story 7.2): a conta emissora é OBRIGATÓRIA — emissão usa a conta do MÉDICO;
// cancelamento/reconsulta usam SEMPRE a conta gravada no BOLETO (arquitetura §2-D3).
// Trocar de provedor não exige redesenho: crie a nova classe implementando BoletoGatewayPort
// e registre aqui.
import type { BoletoGatewayPort, ContaEmissora, GatewayBoleto } from '@cobranca/shared';
import { getServerEnv, getCredenciaisConta } from '@/lib/env';
import { MockGateway } from './mock-gateway';
import { CoraGateway } from './cora-gateway';

/**
 * Retorna a implementação correta de BoletoGatewayPort com base em BOLETO_GATEWAY,
 * autenticada com as credenciais da conta emissora informada.
 * Conta sem credenciais → getCredenciaisConta lança erro nomeando conta e vars
 * (a outra conta não é afetada). O MockGateway ignora a conta (dev/testes).
 * Também retorna o nome do gateway para persistir na tabela de auditoria.
 */
export function criarBoletoGateway(conta: ContaEmissora): { gateway: BoletoGatewayPort; nome: GatewayBoleto } {
  const { BOLETO_GATEWAY, MOCK_INVOICE_STATUS } = getServerEnv();
  if (BOLETO_GATEWAY === 'cora') {
    return { gateway: new CoraGateway(getCredenciaisConta(conta)), nome: 'cora' };
  }
  // Débito M-1 (Story 6.1): status da reconsulta configurável — 'paid' (default) testa o fluxo
  // do webhook; MOCK_INVOICE_STATUS=open permite testar cancelamento em dev sem baixa falsa.
  return {
    gateway: new MockGateway({ status: MOCK_INVOICE_STATUS, valorPago: null, pagoEm: null }),
    nome: 'mock',
  };
}
