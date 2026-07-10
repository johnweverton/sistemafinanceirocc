// Testes dos mappers para conta_emissora (Story 7.1, AC 5/6): round-trip snake↔camel
// e default seguro 'mc' em bancos pré-migration 0021 (regressão zero).
import { describe, it, expect } from 'vitest';
import {
  toBoleto,
  toMedico,
  toRecebivel,
  medicoUpdateToRow,
  type BoletoRow,
  type MedicoRow,
  type RecebivelRow,
} from '../../../src/server/repositories/mappers';

const boletoRowBase: BoletoRow = {
  id: 'b1',
  execucao_resultado_id: 'r1',
  gateway: 'cora',
  id_externo: 'inv_123',
  status: 'emitido',
  emitido_por: 'u1',
  emitido_em: '2026-07-10T00:00:00Z',
  payload_resposta: null,
  vencimento: '2026-08-10',
  pago_em: null,
  valor_pago: null,
  atualizado_em: null,
  cancelado_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
};

const medicoRowBase: MedicoRow = {
  id: 'm1',
  cpf: '00000000001',
  nome: 'Dra. A',
  especialidade: null,
  status_hapvida: 'credenciado',
  faz_outros_hospitais: false,
  faz_imobilizacoes: false,
  modo_mudanca_data: 'nao',
  colaborador_responsavel: null,
  ativo: true,
  necessita_configuracao: false,
  pagador_tipo: null,
  pagador_documento: null,
  pagador_nome: null,
  email: null,
  whatsapp: null,
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  cidade: null,
  uf: null,
  dias_vencimento: null,
  multa_percent: null,
  juros_mes_percent: null,
  desconto_percent: null,
  desconto_dias: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const recebivelRowBase: RecebivelRow = {
  boleto_id: 'b1',
  execucao_resultado_id: 'r1',
  id_externo: 'inv_123',
  competencia: '2026-06',
  medico_id: 'm1',
  nome: 'Dra. A',
  valor: 263.59,
  vencimento: '2026-08-10',
  pago_em: null,
  valor_pago: null,
  emitido_em: '2026-07-10T00:00:00Z',
  status_derivado: 'em_aberto',
};

describe('conta_emissora nos mappers', () => {
  it('toBoleto mapeia a coluna quando presente', () => {
    const b = toBoleto({ ...boletoRowBase, conta_emissora: 'cavalcante_viana' });
    expect(b.contaEmissora).toBe('cavalcante_viana');
  });

  it('toBoleto default mc quando a coluna não existe (banco pré-migration 0021)', () => {
    expect(toBoleto(boletoRowBase).contaEmissora).toBe('mc');
  });

  it('toMedico mapeia a coluna e default mc na ausência', () => {
    expect(toMedico({ ...medicoRowBase, conta_emissora: 'cavalcante_viana' }).contaEmissora).toBe(
      'cavalcante_viana',
    );
    expect(toMedico(medicoRowBase).contaEmissora).toBe('mc');
  });

  it('toRecebivel mapeia a coluna e default mc na ausência', () => {
    expect(
      toRecebivel({ ...recebivelRowBase, conta_emissora: 'cavalcante_viana' }).contaEmissora,
    ).toBe('cavalcante_viana');
    expect(toRecebivel(recebivelRowBase).contaEmissora).toBe('mc');
  });

  it('medicoUpdateToRow achata contaEmissora → conta_emissora', () => {
    const row = medicoUpdateToRow({ contaEmissora: 'cavalcante_viana' });
    expect(row.conta_emissora).toBe('cavalcante_viana');
  });
});
