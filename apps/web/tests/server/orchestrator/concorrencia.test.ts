import { describe, it, expect } from 'vitest';
import { executarComLimite } from '../../../src/server/orchestrator/concorrencia';

describe('executarComLimite', () => {
  it('executa todos os itens, respeitando o limite de concorrência simultânea', async () => {
    const itens = Array.from({ length: 10 }, (_, i) => i);
    let emAndamento = 0;
    let picoConcorrencia = 0;
    const processados: number[] = [];

    await executarComLimite(itens, 3, async (item) => {
      emAndamento += 1;
      picoConcorrencia = Math.max(picoConcorrencia, emAndamento);
      await new Promise((r) => setTimeout(r, 5));
      processados.push(item);
      emAndamento -= 1;
    });

    expect(processados.sort((a, b) => a - b)).toEqual(itens);
    expect(picoConcorrencia).toBeLessThanOrEqual(3);
    expect(picoConcorrencia).toBeGreaterThan(1);
  });

  it('lista vazia não executa nada', async () => {
    let chamadas = 0;
    await executarComLimite([], 5, async () => {
      chamadas += 1;
    });
    expect(chamadas).toBe(0);
  });

  it('limite maior que a quantidade de itens não quebra nada', async () => {
    const itens = [1, 2];
    const processados: number[] = [];
    await executarComLimite(itens, 10, async (item) => {
      processados.push(item);
    });
    expect(processados.sort()).toEqual([1, 2]);
  });
});
