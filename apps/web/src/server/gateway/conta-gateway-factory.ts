// Factory de ContaBancariaPort — devolve Cora (real, mTLS) ou Mock conforme BOLETO_GATEWAY
// (mesma flag do fluxo de boletos: um ambiente é 'cora' ou 'mock' por inteiro).
// Padrão da 7.2: a conta emissora é OBRIGATÓRIA; conta sem credenciais → getCredenciaisConta
// lança erro nomeando conta e vars faltantes (a outra conta não é afetada — degradação por
// conta, arquitetura §5). O MockContaGateway ignora a conta (dev/testes).
import type { ContaBancariaPort, ContaEmissora } from '@cobranca/shared';
import { getServerEnv, getCredenciaisConta } from '@/lib/env';
import { CoraContaGateway } from './cora-conta-gateway';
import { MockContaGateway } from './mock-conta-gateway';

/**
 * Retorna a implementação correta de ContaBancariaPort para a conta emissora informada.
 * Trocar de provedor não exige redesenho: nova classe implementando a porta + registro aqui.
 */
export function criarContaGateway(conta: ContaEmissora): ContaBancariaPort {
  const { BOLETO_GATEWAY } = getServerEnv();
  if (BOLETO_GATEWAY === 'cora') {
    return new CoraContaGateway(getCredenciaisConta(conta));
  }
  return new MockContaGateway();
}
