// Testes do CÁLCULO EM LOTE de clientes contábeis (feedback do dono, 2026-08-20) — N clientes, 1
// execução, N execucao_resultados, sem encadeamento (cada cálculo é só leitura local). Mesmo
// padrão dos testes do branch singular (execucao-orchestrator-cliente-contabilidade.test.ts).
import { describe, it, expect } from 'vitest';
import {
  iniciarLoteClientesContabilidade,
  processarProximoLote,
  LOTE_CLIENTES_CONTABILIDADE_MAX_ITENS,
  PASSO_PROGRESSO_LOTE_CONTABILIDADE,
} from '../../../src/server/orchestrator/execucao-orchestrator';
import { novoEstado, clienteContabilidadeFake, fakeDeps } from './fake-deps';

describe('iniciarLoteClientesContabilidade — validação', () => {
  it('cria a execução com clientesContabilidadeIds preenchido, sem médicos/empresa/cliente singular', async () => {
    const clientes = [
      clienteContabilidadeFake({ id: 'cc-1', nome: 'A', modoCobranca: 'fixo' }),
      clienteContabilidadeFake({ id: 'cc-2', nome: 'B', modoCobranca: 'fixo' }),
    ];
    const state = novoEstado([], [], clientes);
    const deps = fakeDeps(state, 5, processarProximoLote);

    const exec = await iniciarLoteClientesContabilidade('2026-07', ['cc-1', 'cc-2'], 'u', deps);

    expect(exec.clientesContabilidadeIds).toEqual(['cc-1', 'cc-2']);
    expect(exec.clienteContabilidadeId).toBeNull();
    expect(exec.empresaId).toBeNull();
    expect(exec.totalMedicos).toBe(0);
  });

  it('rejeita ids duplicados (422 SELECAO_DUPLICADA)', async () => {
    const state = novoEstado([], [], [clienteContabilidadeFake({ id: 'cc-1', nome: 'A' })]);
    const deps = fakeDeps(state, 5, processarProximoLote);

    await expect(iniciarLoteClientesContabilidade('2026-07', ['cc-1', 'cc-1'], 'u', deps)).rejects.toMatchObject({
      code: 'SELECAO_DUPLICADA',
    });
  });

  it('rejeita cliente contábil inexistente ou inativo (422 SELECAO_INVALIDA)', async () => {
    const clientes = [
      clienteContabilidadeFake({ id: 'cc-1', nome: 'Ativo' }),
      clienteContabilidadeFake({ id: 'cc-2', nome: 'Inativo', ativo: false }),
    ];
    const state = novoEstado([], [], clientes);
    const deps = fakeDeps(state, 5, processarProximoLote);

    await expect(
      iniciarLoteClientesContabilidade('2026-07', ['cc-1', 'cc-2', 'cc-inexistente'], 'u', deps),
    ).rejects.toMatchObject({ code: 'SELECAO_INVALIDA' });
  });

  it('rejeita lote acima do limite máximo (422 LOTE_MUITO_GRANDE)', async () => {
    const clientes = Array.from({ length: LOTE_CLIENTES_CONTABILIDADE_MAX_ITENS + 1 }, (_, i) =>
      clienteContabilidadeFake({ id: `cc-${i}`, nome: `Cliente ${i}` }),
    );
    const state = novoEstado([], [], clientes);
    const deps = fakeDeps(state, 5, processarProximoLote);

    await expect(
      iniciarLoteClientesContabilidade('2026-07', clientes.map((c) => c.id), 'u', deps),
    ).rejects.toMatchObject({ code: 'LOTE_MUITO_GRANDE' });
  });
});

describe('processarProximoLote — lote de clientes contábeis, fim a fim', () => {
  it('calcula N clientes numa execução só (modo fixo + faixa_faturamento com faturamento lançado)', async () => {
    const clientes = [
      clienteContabilidadeFake({
        id: 'cc-1', nome: 'Fixo A', modoCobranca: 'fixo',
        regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 500 },
      }),
      clienteContabilidadeFake({
        id: 'cc-2', nome: 'Fixo B', modoCobranca: 'fixo',
        regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 800 },
      }),
      clienteContabilidadeFake({
        id: 'cc-3', nome: 'Faixa C', modoCobranca: 'faixa_faturamento',
        regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 300 },
      }),
    ];
    const state = novoEstado([], [], clientes);
    state.faturamentos.set('cc-3:2026-07', {
      id: 'f1', clienteContabilidadeId: 'cc-3', competencia: '2026-07', faturamento: 10000,
      informadoPor: 'u', informadoEm: '2026-07-01T00:00:00Z',
    });
    const deps = fakeDeps(state, 5, processarProximoLote);

    const exec = await iniciarLoteClientesContabilidade('2026-07', ['cc-1', 'cc-2', 'cc-3'], 'u', deps);
    await processarProximoLote(exec.id, deps);

    const final = state.execucoes.get(exec.id)!;
    expect(final.status).toBe('concluido');
    expect(final.totalOk).toBe(3);
    expect(final.totalAlerta).toBe(0);
    expect(final.totalGeralValor).toBe(1600); // 500 + 800 + 300

    const resultados = state.resultados.get(exec.id)!;
    expect(resultados).toHaveLength(3);
    expect(resultados.every((r) => r.medicoId === null)).toBe(true);
    expect(resultados.map((r) => r.r.nome).sort()).toEqual(['Faixa C', 'Fixo A', 'Fixo B']);
  });

  it('faixa_faturamento SEM faturamento lançado vira alerta nesse cliente, sem travar os demais do lote', async () => {
    const clientes = [
      clienteContabilidadeFake({
        id: 'cc-1', nome: 'Fixo A', modoCobranca: 'fixo',
        regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 500 },
      }),
      clienteContabilidadeFake({ id: 'cc-2', nome: 'Faixa Sem Faturamento', modoCobranca: 'faixa_faturamento' }),
    ];
    const state = novoEstado([], [], clientes);
    const deps = fakeDeps(state, 5, processarProximoLote);

    const exec = await iniciarLoteClientesContabilidade('2026-07', ['cc-1', 'cc-2'], 'u', deps);
    await processarProximoLote(exec.id, deps);

    const final = state.execucoes.get(exec.id)!;
    expect(final.totalOk).toBe(1);
    expect(final.totalAlerta).toBe(1);
    expect(final.totalGeralValor).toBe(500); // só o cliente ok entra no total

    const resultados = state.resultados.get(exec.id)!;
    const alerta = resultados.find((r) => r.r.nome === 'Faixa Sem Faturamento')!;
    expect(alerta.r.status).toBe('alerta');
    expect(alerta.r.alertas[0]).toContain('Faturamento não lançado');
  });

  it('cliente que some da base entre a validação e o processamento vira alerta isolado (defesa em profundidade)', async () => {
    // Simula uma corrida (cliente excluído logo após iniciarLoteClientesContabilidade validar) —
    // monta o estado direto, sem passar pela validação de iniciarLoteClientesContabilidade.
    const clientes = [
      clienteContabilidadeFake({
        id: 'cc-1', nome: 'Sobrevivente', modoCobranca: 'fixo',
        regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 400 },
      }),
    ];
    const state = novoEstado([], [], clientes);
    const deps = fakeDeps(state, 5, processarProximoLote);
    state.execucoes.set('exec-manual', {
      id: 'exec-manual', competencia: '2026-07', iniciadoPor: 'u', iniciadoEm: new Date().toISOString(),
      finalizadoEm: null, status: 'processando', progresso: 0, totalMedicos: 0, totalOk: null,
      totalAlerta: null, totalSemDados: null, totalAcumulado: null, totalGeralValor: null,
      empresaId: null, clienteContabilidadeId: null, ehAdicional: false,
      clientesContabilidadeIds: ['cc-1', 'cc-sumiu'],
    });
    state.resultados.set('exec-manual', []);

    await processarProximoLote('exec-manual', deps);

    const final = state.execucoes.get('exec-manual')!;
    expect(final.totalOk).toBe(1);
    expect(final.totalAlerta).toBe(1);
    const resultados = state.resultados.get('exec-manual')!;
    const alerta = resultados.find((r) => r.r.nome !== 'Sobrevivente')!;
    expect(alerta.r.status).toBe('alerta');
    expect(alerta.r.alertas[0]).toContain('Falha ao calcular');
  });
});

// Story 12.5 (R-3/G-06) — progresso gravado DURANTE o lote. Sem isto a barra do diálogo ficaria
// parada em 0% por até 300s e depois pularia para 100%, que é o gap que a story fecha.
describe('processarProximoLote — progresso real do lote de clientes contábeis (Story 12.5)', () => {
  function loteDe(n: number) {
    const clientes = Array.from({ length: n }, (_, i) =>
      clienteContabilidadeFake({
        id: `cc-${i}`,
        nome: `Cliente ${i}`,
        modoCobranca: 'fixo',
        regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 100 },
      }),
    );
    const state = novoEstado([], [], clientes);
    const deps = fakeDeps(state, 5, processarProximoLote);
    return { clientes, state, deps };
  }

  it('grava progresso intermediário ao longo do lote, em ordem crescente e sem passar de 99', async () => {
    const { clientes, state, deps } = loteDe(40);
    const gravados: number[] = [];
    const original = deps.atualizarProgresso;
    deps.atualizarProgresso = async (id, progresso) => {
      gravados.push(progresso);
      await original(id, progresso);
    };

    const exec = await iniciarLoteClientesContabilidade('2026-07', clientes.map((c) => c.id), 'u', deps);
    await processarProximoLote(exec.id, deps);

    expect(gravados.length).toBeGreaterThan(1);
    // Nunca 100 daqui: quem fecha em 100 é `concluirExecucao` — só depois de agregar os totais.
    expect(Math.max(...gravados)).toBeLessThanOrEqual(99);
    expect([...gravados].sort((a, b) => a - b)).toEqual(gravados);
    // Passo mínimo respeitado: no máximo ~100/PASSO escritas, não 1 por cliente.
    expect(gravados.length).toBeLessThanOrEqual(Math.ceil(100 / PASSO_PROGRESSO_LOTE_CONTABILIDADE));
    expect(state.execucoes.get(exec.id)!.progresso).toBe(100);
  });

  it('falha ao gravar progresso NÃO derruba o lote (progresso é enfeite de UI)', async () => {
    const { clientes, state, deps } = loteDe(40);
    deps.atualizarProgresso = async () => {
      throw new Error('rede caiu ao gravar progresso');
    };

    const exec = await iniciarLoteClientesContabilidade('2026-07', clientes.map((c) => c.id), 'u', deps);
    await processarProximoLote(exec.id, deps);

    const final = state.execucoes.get(exec.id)!;
    expect(final.status).toBe('concluido');
    expect(final.totalOk).toBe(40);
  });
});
