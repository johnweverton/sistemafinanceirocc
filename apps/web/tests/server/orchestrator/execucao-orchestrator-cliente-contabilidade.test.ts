// Testes do branch de CLIENTE CONTÁBIL no orquestrador (Story 11.3, Epic 11) — mesmo padrão dos
// testes de empresa em execucao-integracao.test.ts (Story 10.4b), mas sem lotes/médicos: só
// regra de preço do cliente + faturamento lançado (Story 11.2), via aplicarRegraPreco.
import { describe, it, expect } from 'vitest';
import { iniciarExecucao, processarProximoLote } from '../../../src/server/orchestrator/execucao-orchestrator';
import { novoEstado, clienteContabilidadeFake, fakeDeps } from './fake-deps';

describe('Orquestrador — cliente contábil, modo fixo (Story 11.3)', () => {
  it('valor fixo do cadastro vira o resultado, sem precisar de faturamento lançado', async () => {
    const cliente = clienteContabilidadeFake({
      id: 'cc-1',
      nome: 'Clínica X',
      modoCobranca: 'fixo',
      regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 1200 },
    });
    const state = novoEstado([], [], [cliente]);
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-07', [], 'u', deps, undefined, 'cc-1');
    expect(exec.clienteContabilidadeId).toBe('cc-1');

    await processarProximoLote(exec.id, deps);

    const final = state.execucoes.get(exec.id)!;
    expect(final.status).toBe('concluido');
    expect(final.totalGeralValor).toBe(1200);
    expect(final.totalOk).toBe(1);

    const resultado = state.resultadosClienteContabilidade.get(exec.id)!;
    expect(resultado.status).toBe('ok');
    expect(resultado.totalValor).toBe(1200);
    expect(resultado.nome).toBe('Clínica X');

    // Regressão: nenhum resultado por-médico nem de empresa foi gravado.
    expect(state.resultados.get(exec.id)).toEqual([]);
    expect(state.resultadosEmpresa.has(exec.id)).toBe(false);
  });
});

describe('Orquestrador — cliente contábil, modo faixa_faturamento (Story 11.3)', () => {
  const regraFaixa = {
    forma: 'faixa_faturamento' as const,
    base: null,
    limiar: 5000,
    taxa: null,
    valorFixo: null,
    valorAbaixoLimiar: 250,
    valorAcimaLimiar: 480.56,
  };

  it('faturamento lançado abaixo do limiar → resultado ok com o valor da faixa de baixo', async () => {
    const cliente = clienteContabilidadeFake({ id: 'cc-2', nome: 'Padaria Bom Pão', regraPreco: regraFaixa });
    const state = novoEstado([], [], [cliente]);
    state.faturamentos.set('cc-2:2026-07', {
      id: 'fat-1',
      clienteContabilidadeId: 'cc-2',
      competencia: '2026-07',
      faturamento: 4500,
      informadoPor: 'u',
      informadoEm: '2026-07-01T00:00:00Z',
    });
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-07', [], 'u', deps, undefined, 'cc-2');
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultadosClienteContabilidade.get(exec.id)!;
    expect(resultado.status).toBe('ok');
    expect(resultado.totalValor).toBe(250);
  });

  it('faturamento lançado acima do limiar → resultado ok com o valor da faixa de cima', async () => {
    const cliente = clienteContabilidadeFake({ id: 'cc-3', nome: 'Mercado Silva', regraPreco: regraFaixa });
    const state = novoEstado([], [], [cliente]);
    state.faturamentos.set('cc-3:2026-07', {
      id: 'fat-2',
      clienteContabilidadeId: 'cc-3',
      competencia: '2026-07',
      faturamento: 8000,
      informadoPor: 'u',
      informadoEm: '2026-07-01T00:00:00Z',
    });
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-07', [], 'u', deps, undefined, 'cc-3');
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultadosClienteContabilidade.get(exec.id)!;
    expect(resultado.totalValor).toBe(480.56);
  });

  it('SEM faturamento lançado → alerta explícito, valor 0 (nunca chuta)', async () => {
    const cliente = clienteContabilidadeFake({ id: 'cc-4', nome: 'Sem Lançamento', regraPreco: regraFaixa });
    const state = novoEstado([], [], [cliente]);
    // Nenhum faturamento lançado para a competência.
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-07', [], 'u', deps, undefined, 'cc-4');
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultadosClienteContabilidade.get(exec.id)!;
    expect(resultado.status).toBe('alerta');
    expect(resultado.totalValor).toBe(0);
    expect(resultado.alertas[0]).toContain('Faturamento não lançado');

    const final = state.execucoes.get(exec.id)!;
    expect(final.totalAlerta).toBe(1);
    expect(final.status).toBe('concluido'); // conclui mesmo em alerta — não é falha de infra
  });
});

describe('Orquestrador — cliente contábil, validação em iniciarExecucao (Story 11.3)', () => {
  it('rejeita cliente contábil inexistente (422)', async () => {
    const state = novoEstado([], [], []);
    const deps = fakeDeps(state, 5, processarProximoLote);
    await expect(
      iniciarExecucao('2026-07', [], 'u', deps, undefined, 'inexistente'),
    ).rejects.toMatchObject({ status: 422, code: 'CLIENTE_CONTABILIDADE_NAO_ENCONTRADO' });
    expect(state.execucoes.size).toBe(0);
  });

  it('rejeita cliente contábil inativo (422)', async () => {
    const cliente = clienteContabilidadeFake({ id: 'cc-5', nome: 'Inativo', ativo: false });
    const state = novoEstado([], [], [cliente]);
    const deps = fakeDeps(state, 5, processarProximoLote);
    await expect(
      iniciarExecucao('2026-07', [], 'u', deps, undefined, 'cc-5'),
    ).rejects.toMatchObject({ status: 422, code: 'CLIENTE_CONTABILIDADE_INATIVO' });
    expect(state.execucoes.size).toBe(0);
  });

  it('rejeita quando empresaId e clienteContabilidadeId vêm setados juntos (422)', async () => {
    const cliente = clienteContabilidadeFake({ id: 'cc-6', nome: 'X' });
    const state = novoEstado([], [], [cliente]);
    const deps = fakeDeps(state, 5, processarProximoLote);
    await expect(
      iniciarExecucao('2026-07', [], 'u', deps, 'emp-1', 'cc-6'),
    ).rejects.toMatchObject({ status: 422 });
  });
});
