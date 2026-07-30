// Regressão (achado do dono, 2026-07-30): reimportar uma planilha corrigida (após uma 1ª
// importação com erros) duplicava registros que já tinham sido criados com sucesso, em vez de
// só atualizá-los. `processarLinhas` é o loop compartilhado pelas 3 rotas de importação
// (médicos/empresas/clientes de contabilidade) — testamos aqui, isolado de banco/schema real,
// que ele chama `atualizar` (não `criar`) quando `encontrarExistenteId` acha um match.
import { describe, it, expect, vi } from 'vitest';
import { processarLinhas, normalizarNome } from '@/server/csv/planilha-import';

interface FakeInput {
  nome: string;
}

const schemaFake = {
  safeParse: (input: unknown) => ({ success: true as const, data: input as FakeInput }),
};

describe('processarLinhas — upsert por chave natural', () => {
  it('cria quando não há match em encontrarExistenteId', async () => {
    const criar = vi.fn(async (data: FakeInput) => ({ id: `novo-${data.nome}` }));
    const atualizar = vi.fn(async (id: string) => ({ id }));

    const resultado = await processarLinhas(
      [{ nome: 'Cliente Novo' }],
      {
        rowToInput: (row) => ({ nome: row.nome ?? '' }),
        schema: schemaFake,
        criar,
        atualizar,
        encontrarExistenteId: () => undefined,
        chaveLinha: (row) => row.nome ?? '',
      },
    );

    expect(criar).toHaveBeenCalledTimes(1);
    expect(atualizar).not.toHaveBeenCalled();
    expect(resultado).toEqual({ criados: 1, atualizados: 0, erros: [] });
  });

  it('atualiza (não duplica) quando a linha casa com um registro já existente', async () => {
    const criar = vi.fn(async (data: FakeInput) => ({ id: `novo-${data.nome}` }));
    const atualizar = vi.fn(async (id: string) => ({ id }));
    const existentesPorNome = new Map([[normalizarNome('Cliente Já Cadastrado'), 'id-existente']]);

    const resultado = await processarLinhas(
      [{ nome: 'Cliente Já Cadastrado' }],
      {
        rowToInput: (row) => ({ nome: row.nome ?? '' }),
        schema: schemaFake,
        criar,
        atualizar,
        encontrarExistenteId: (data) => existentesPorNome.get(normalizarNome(data.nome)),
        chaveLinha: (row) => row.nome ?? '',
      },
    );

    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledWith('id-existente', { nome: 'Cliente Já Cadastrado' });
    expect(criar).not.toHaveBeenCalled();
    expect(resultado).toEqual({ criados: 0, atualizados: 1, erros: [] });
  });

  it('reimportar a mesma planilha inteira não duplica nenhuma linha já existente', async () => {
    // Simula o cenário relatado: 1ª importação criou 2 registros; reimportar a MESMA planilha
    // (idêntica ou com pequenas correções) deve atualizar os 2, nunca criar de novo.
    const banco = new Map<string, { id: string; nome: string }>();
    let seq = 0;
    const criar = vi.fn(async (data: FakeInput) => {
      const id = `id-${++seq}`;
      banco.set(id, { id, nome: data.nome });
      return { id };
    });
    const atualizar = vi.fn(async (id: string, data: FakeInput) => {
      banco.set(id, { id, nome: data.nome });
      return { id };
    });
    function existentesPorNome() {
      const m = new Map<string, string>();
      for (const r of banco.values()) m.set(normalizarNome(r.nome), r.id);
      return m;
    }

    const linhas = [{ nome: 'Alfa Contabilidade' }, { nome: 'Beta Serviços' }];
    const opts = {
      rowToInput: (row: Record<string, string>) => ({ nome: row.nome ?? '' }),
      schema: schemaFake,
      criar,
      atualizar,
      chaveLinha: (row: Record<string, string>) => row.nome ?? '',
    };

    const primeira = await processarLinhas(linhas, {
      ...opts,
      encontrarExistenteId: (data) => existentesPorNome().get(normalizarNome(data.nome)),
    });
    expect(primeira).toEqual({ criados: 2, atualizados: 0, erros: [] });
    expect(banco.size).toBe(2);

    const segunda = await processarLinhas(linhas, {
      ...opts,
      encontrarExistenteId: (data) => existentesPorNome().get(normalizarNome(data.nome)),
    });
    expect(segunda).toEqual({ criados: 0, atualizados: 2, erros: [] });
    expect(banco.size).toBe(2); // nenhuma duplicata
  });
});
