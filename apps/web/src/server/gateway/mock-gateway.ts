// Mock Gateway — implementação de BoletoGatewayPort para testes e desenvolvimento.
// Simula emissão sem rede, sem certificado — retorna sucesso imediato.
import type { BoletoGatewayPort, DadosEmissaoBoleto, EmissaoBoleto } from '@cobranca/shared';

export class MockGateway implements BoletoGatewayPort {
  async emitir(dados: DadosEmissaoBoleto): Promise<EmissaoBoleto> {
    // Simula latência mínima para parecer realista em testes de integração.
    await new Promise((r) => setTimeout(r, 100));

    return {
      idExterno: `MOCK-${crypto.randomUUID()}`,
      status: 'emitido',
      payloadResposta: {
        mock: true,
        execucaoResultadoId: dados.execucaoResultadoId,
        valor: dados.valor,
        documento: dados.pagador.documento,
        nome: dados.pagador.nome,
        competencia: dados.competencia,
        emitidoEm: new Date().toISOString(),
      },
    };
  }
}
