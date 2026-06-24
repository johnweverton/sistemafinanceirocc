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
  const { BOLETO_GATEWAY } = getServerEnv();
  if (BOLETO_GATEWAY === 'cora') {
    return { gateway: new CoraGateway(), nome: 'cora' };
  }
  return { gateway: new MockGateway(), nome: 'mock' };
}
