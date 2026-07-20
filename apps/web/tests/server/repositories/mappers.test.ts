// Testes UNITÁRIOS dos mapeadores (pura conversão snake_case ↔ camelCase). Sem I/O.
import { describe, it, expect } from 'vitest';
import {
  toExecucao,
  toExecucaoResultado,
  toExecucaoSelecao,
  toExecucaoSelecaoRow,
  toEmpresa,
  empresaUpdateToRow,
  toBoleto,
  toBoletoEvento,
  type ExecucaoRow,
  type ExecucaoResultadoRow,
  type ExecucaoSelecaoRow,
  type EmpresaRow,
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

describe('toExecucaoSelecao / toExecucaoSelecaoRow (Story 10.2 — produção de consultas)', () => {
  it('mapeia a produção de consultas quando presente', () => {
    const row: ExecucaoSelecaoRow = {
      execucao_id: 'e1',
      medico_id: 'm1',
      producao_externa_id: 'p-guias',
      producao_nome: 'Junho 2026',
      producao_consultas_externa_id: 'p-consultas',
      producao_consultas_nome: 'Consultas Junho 2026',
    };
    const s = toExecucaoSelecao(row);
    expect(s.producaoConsultasExternaId).toBe('p-consultas');
    expect(s.producaoConsultasNome).toBe('Consultas Junho 2026');
  });

  it('normaliza ausência (undefined) para null — médico sem componente de consultas', () => {
    const row: ExecucaoSelecaoRow = {
      execucao_id: 'e1',
      medico_id: 'm1',
      producao_externa_id: 'p-guias',
      producao_nome: 'Junho 2026',
    };
    const s = toExecucaoSelecao(row);
    expect(s.producaoConsultasExternaId).toBeNull();
    expect(s.producaoConsultasNome).toBeNull();
  });

  it('toExecucaoSelecaoRow achata de volta para snake_case, com default null', () => {
    const row = toExecucaoSelecaoRow({
      execucaoId: 'e1',
      medicoId: 'm1',
      producaoExternaId: 'p-guias',
      producaoNome: 'Junho 2026',
    });
    expect(row.producao_consultas_externa_id).toBeNull();
    expect(row.producao_consultas_nome).toBeNull();
  });
});

describe('toEmpresa / empresaUpdateToRow (Story 10.4a)', () => {
  const rowBase: EmpresaRow = {
    id: 'emp-1',
    nome: 'MEDISA',
    pagador_tipo: 'PJ',
    pagador_documento: '12345678000199',
    pagador_nome: 'MEDISA Ltda',
    email: null,
    whatsapp: null,
    cep: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    conta_emissora: 'mc',
    dias_vencimento: null,
    multa_percent: null,
    juros_mes_percent: null,
    desconto_percent: null,
    desconto_dias: null,
    regra_preco_forma: 'por_guia',
    regra_preco_base: null,
    regra_preco_limiar: null,
    regra_preco_taxa: 6.41,
    regra_preco_valor_fixo: null,
    ativo: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('toEmpresa mapeia cobrança PJ e regra de preço (mesmos helpers de médico)', () => {
    const e = toEmpresa(rowBase);
    expect(e.nome).toBe('MEDISA');
    expect(e.cobranca).toMatchObject({ pagadorTipo: 'PJ', pagadorDocumento: '12345678000199' });
    expect(e.regraPreco).toMatchObject({ forma: 'por_guia', taxa: 6.41 });
    expect(e.condicoes).toBeNull(); // nenhum override comercial preenchido
  });

  it('toEmpresa devolve cobranca/regraPreco null quando colunas ausentes', () => {
    const e = toEmpresa({ ...rowBase, pagador_tipo: null, regra_preco_forma: null });
    expect(e.cobranca).toBeNull();
    expect(e.regraPreco).toBeNull();
  });

  it('empresaUpdateToRow achata cobrança e regra de preço', () => {
    const row = empresaUpdateToRow({
      nome: 'MEDISA',
      cobranca: { pagadorTipo: 'PJ', pagadorDocumento: '12345678000199', pagadorNome: 'MEDISA Ltda', email: '', whatsapp: null, cep: '', logradouro: '', numero: '', complemento: null, bairro: '', cidade: '', uf: '' },
      regraPreco: { forma: 'por_guia', base: null, limiar: null, taxa: 6.41, valorFixo: null },
    });
    expect(row.pagador_documento).toBe('12345678000199');
    expect(row.regra_preco_forma).toBe('por_guia');
    expect(row.regra_preco_taxa).toBe(6.41);
  });

  it('empresaUpdateToRow com regraPreco null limpa as colunas', () => {
    const row = empresaUpdateToRow({ regraPreco: null });
    expect(row.regra_preco_forma).toBeNull();
    expect(row.regra_preco_taxa).toBeNull();
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
