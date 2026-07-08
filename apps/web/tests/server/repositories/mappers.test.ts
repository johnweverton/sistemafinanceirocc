// Testes UNITÁRIOS dos mapeadores (pura conversão snake_case ↔ camelCase). Sem I/O.
import { describe, it, expect } from 'vitest';
import {
  toExecucao,
  toExecucaoResultado,
  toBoleto,
  toBoletoEvento,
  type ExecucaoRow,
  type ExecucaoResultadoRow,
  type BoletoRow,
  type BoletoEventoRow,
} from '../../../src/server/repositories/mappers';

describe('toExecucao', () => {
  it('mapeia colunas snake_case para o tipo de domínio', () => {
    const row: ExecucaoRow = {
      id: 'e1',
      competencia: '2026-06',
      iniciado_por: 'u1',
      iniciado_em: '2026-06-24T00:00:00Z',
      finalizado_em: null,
      status: 'processando',
      progresso: 33,
      total_medicos: 120,
      total_ok: null,
      total_alerta: null,
      total_sem_dados: null,
      total_geral_valor: null,
    };
    const e = toExecucao(row);
    expect(e.iniciadoPor).toBe('u1');
    expect(e.totalMedicos).toBe(120);
    expect(e.progresso).toBe(33);
    expect(e.status).toBe('processando');
  });
});

describe('toExecucaoResultado', () => {
  it('mapeia e normaliza alertas null → []', () => {
    const row: ExecucaoResultadoRow = {
      id: 'r1',
      execucao_id: 'e1',
      medico_id: 'm1',
      cpf: '00000000001',
      nome: 'Dra. A',
      procedimentos: 17,
      cirurgias: 4,
      guias: 17,
      guias_consolidado: 6,
      subtotais: [{ classe: 'HAPVIDA_CRED', guias: 17, valor: 263.59, faixa: 'até 30 guias' }],
      total_valor: 263.59,
      status: 'alerta',
      alertas: null,
      status_original: null,
      revisado_por: null,
      revisado_em: null,
      motivo_revisao: null,
    };
    const r = toExecucaoResultado(row);
    expect(r.execucaoId).toBe('e1');
    expect(r.guiasConsolidado).toBe(6);
    expect(r.alertas).toEqual([]); // null vira []
    expect(r.subtotais?.[0]?.classe).toBe('HAPVIDA_CRED');
    expect(r.statusOriginal).toBeNull();
  });

  it('mapeia os campos de revisão manual quando presentes', () => {
    const row: ExecucaoResultadoRow = {
      id: 'r2', execucao_id: 'e1', medico_id: 'm1', cpf: '00000000001', nome: 'Dra. A',
      procedimentos: 17, cirurgias: 4, guias: 17, guias_consolidado: 6, subtotais: null,
      total_valor: 263.59, status: 'ok', alertas: ['VARIAÇÃO ALTA...'],
      status_original: 'alerta', revisado_por: 'u1', revisado_em: '2026-07-08T10:00:00Z',
      motivo_revisao: 'Confirmado com o médico, aumento real de produção.',
    };
    const r = toExecucaoResultado(row);
    expect(r.status).toBe('ok');
    expect(r.statusOriginal).toBe('alerta');
    expect(r.revisadoPor).toBe('u1');
    expect(r.motivoRevisao).toBe('Confirmado com o médico, aumento real de produção.');
  });
});

describe('toBoleto (Épico 4 — campos de baixa)', () => {
  it('mapeia colunas de baixa (vencimento/pago_em/valor_pago)', () => {
    const row: BoletoRow = {
      id: 'b1',
      execucao_resultado_id: 'r1',
      gateway: 'cora',
      id_externo: 'inv_1',
      status: 'pago',
      emitido_por: 'u1',
      emitido_em: '2026-06-01T00:00:00Z',
      payload_resposta: { ok: true },
      vencimento: '2026-07-01',
      pago_em: '2026-06-15T12:00:00Z',
      valor_pago: 1500.5,
      atualizado_em: '2026-06-15T12:00:00Z',
      cancelado_em: null,
      cancelado_por: null,
      motivo_cancelamento: null,
    };
    const b = toBoleto(row);
    expect(b.status).toBe('pago');
    expect(b.vencimento).toBe('2026-07-01');
    expect(b.pagoEm).toBe('2026-06-15T12:00:00Z');
    expect(b.valorPago).toBe(1500.5);
    expect(b.canceladoEm).toBeNull();
  });

  it('mapeia colunas de cancelamento ativo (Story 6.1)', () => {
    const row: BoletoRow = {
      id: 'b3',
      execucao_resultado_id: 'r3',
      gateway: 'cora',
      id_externo: 'inv_3',
      status: 'cancelado',
      emitido_por: 'u1',
      emitido_em: '2026-07-01T00:00:00Z',
      payload_resposta: {},
      vencimento: '2026-08-01',
      pago_em: null,
      valor_pago: null,
      atualizado_em: '2026-07-08T10:00:00Z',
      cancelado_em: '2026-07-08T10:00:00Z',
      cancelado_por: 'u2',
      motivo_cancelamento: 'Valor incorreto — reemissão',
    };
    const b = toBoleto(row);
    expect(b.status).toBe('cancelado');
    expect(b.canceladoEm).toBe('2026-07-08T10:00:00Z');
    expect(b.canceladoPor).toBe('u2');
    expect(b.motivoCancelamento).toBe('Valor incorreto — reemissão');
  });

  it('normaliza campos de baixa ausentes para null', () => {
    const row = {
      id: 'b2',
      execucao_resultado_id: 'r2',
      gateway: 'mock',
      id_externo: null,
      status: 'emitido',
      emitido_por: 'u1',
      emitido_em: '2026-06-01T00:00:00Z',
      payload_resposta: null,
      vencimento: null,
      pago_em: null,
      valor_pago: null,
      atualizado_em: null,
    } as BoletoRow;
    const b = toBoleto(row);
    expect(b.pagoEm).toBeNull();
    expect(b.valorPago).toBeNull();
    expect(b.vencimento).toBeNull();
  });
});

describe('toBoletoEvento', () => {
  it('mapeia colunas do evento de webhook', () => {
    const row: BoletoEventoRow = {
      id: 'ev1',
      boleto_id: 'b1',
      id_externo: 'inv_1',
      evento_id: 'evt_123',
      evento_tipo: 'invoice.paid',
      status_reconsultado: 'paid',
      payload: { raw: true },
      recebido_em: '2026-06-15T12:00:00Z',
    };
    const e = toBoletoEvento(row);
    expect(e.boletoId).toBe('b1');
    expect(e.eventoId).toBe('evt_123');
    expect(e.eventoTipo).toBe('invoice.paid');
    expect(e.statusReconsultado).toBe('paid');
  });
});
