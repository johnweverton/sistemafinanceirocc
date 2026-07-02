// Testes do MockGateway — verifica contrato BoletoGatewayPort sem rede.
import { describe, it, expect } from 'vitest';
import { MockGateway } from '@/server/gateway/mock-gateway';
import type { DadosEmissaoBoleto } from '@cobranca/shared';

const dadosPadrao: DadosEmissaoBoleto = {
  execucaoResultadoId: '00000000-0000-0000-0000-000000000001',
  competencia: '2025-06',
  valor: 1500.0,
  pagador: {
    nome: 'Dr. Teste',
    documento: '12345678901',
    tipo: 'CPF',
    email: 'dr.teste@exemplo.com',
    endereco: {
      cep: '60000000',
      logradouro: 'Rua A',
      numero: '100',
      complemento: null,
      bairro: 'Centro',
      cidade: 'Fortaleza',
      uf: 'CE',
    },
  },
  condicoes: {
    diasVencimento: 30,
    multaPercent: null,
    jurosMesPercent: null,
    descontoPercent: null,
    descontoDias: null,
  },
};

describe('MockGateway', () => {
  it('retorna status emitido com idExterno preenchido', async () => {
    const gateway = new MockGateway();
    const resultado = await gateway.emitir(dadosPadrao);

    expect(resultado.status).toBe('emitido');
    expect(resultado.idExterno).toMatch(/^MOCK-/);
    expect(resultado.idExterno.length).toBeGreaterThan(5);
  });

  it('inclui dados de entrada no payloadResposta (auditoria)', async () => {
    const gateway = new MockGateway();
    const resultado = await gateway.emitir(dadosPadrao);
    const payload = resultado.payloadResposta as Record<string, unknown>;

    expect(payload.mock).toBe(true);
    expect(payload.valor).toBe(1500.0);
    expect(payload.documento).toBe('12345678901');
    expect(payload.nome).toBe('Dr. Teste');
    expect(payload.competencia).toBe('2025-06');
  });

  it('gera idExterno único a cada chamada', async () => {
    const gateway = new MockGateway();
    const r1 = await gateway.emitir(dadosPadrao);
    const r2 = await gateway.emitir(dadosPadrao);

    expect(r1.idExterno).not.toBe(r2.idExterno);
  });
});
