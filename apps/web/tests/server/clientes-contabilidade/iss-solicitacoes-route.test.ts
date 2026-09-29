// Integração das rotas do OPERADOR para as solicitações de busca no ISS (Story 13.5, AC 7–9):
// rota → zod → repositório real → banco em memória que reproduz o índice único parcial da 0062.
// Só a sessão é dublê (depende do Supabase Auth), como em propostas-iss-route.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  criarBanco,
  criarSupabaseFake,
  solicitacaoRow,
  type FakeBanco,
} from '../agente-iss/fake-supabase-iss';

let banco: FakeBanco;
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => criarSupabaseFake(banco) }));

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({ requireRole: (...a: unknown[]) => mockRequireRole(...a) }));

import { ApiError } from '@/lib/api-error';
import { GET, POST, dynamic } from '@/app/api/clientes-contabilidade/faturamentos/iss-solicitacoes/route';
import { POST as cancelar } from '@/app/api/clientes-contabilidade/faturamentos/iss-solicitacoes/[id]/cancelar/route';

const USUARIO = '00000000-0000-4000-8000-0000000000aa';
const S1 = '33333333-3333-4333-8333-333333333333';
const semParams = { params: {} as Record<string, never> };
const url = 'http://test/api/clientes-contabilidade/faturamentos/iss-solicitacoes';

function post(corpo: unknown) {
  return POST(
    new Request(url, { method: 'POST', body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }),
    semParams,
  );
}
const get = (qs: string) => GET(new Request(`${url}${qs}`), semParams);
const postCancelar = (id: string) =>
  cancelar(new Request(`${url}/${id}/cancelar`, { method: 'POST' }), { params: { id } });

beforeEach(() => {
  banco = criarBanco();
  mockRequireRole.mockReset();
  mockRequireRole.mockResolvedValue({ userId: USUARIO, papel: 'financeiro' });
});

describe('POST iss-solicitacoes (AC 7)', () => {
  it('cria pendente com solicitado_por da sessão → 201', async () => {
    const r = await post({ competencia: '2026-08', documentos: ['08.293.377/0001-98'] });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ competencia: '2026-08', status: 'pendente', solicitadoPor: USUARIO, documentos: ['08293377000198'] });
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'colaborador', 'financeiro']);
  });

  it('idempotente: já existe ativa → 200 com a MESMA, sem duplicar', async () => {
    const primeira = await (await post({ competencia: '2026-08', documentos: ['67643870000150'] })).json();
    const r = await post({ competencia: '2026-08', documentos: ['08.293.377/0001-98'] });
    expect(r.status).toBe(200);
    expect((await r.json()).id).toBe(primeira.id);
    expect(banco.tabelas.iss_solicitacoes).toHaveLength(1);
  });

  it('"Tentar de novo" de uma empresa grava só aquele documento, em dígitos', async () => {
    const r = await post({ competencia: '2026-08', documentos: ['08.293.377/0001-98'] });
    expect((await r.json()).documentos).toEqual(['08293377000198']);
  });

  it('corrida no banco (23505) também devolve a existente com 200', async () => {
    let injetou = false;
    banco.antesDe = (op) => {
      if (op === 'insert' && !injetou) {
        injetou = true;
        banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1 }));
      }
    };
    const r = await post({ competencia: '2026-08', documentos: ['08.293.377/0001-98'] });
    expect(r.status).toBe(200);
    expect((await r.json()).id).toBe(S1);
  });

  it.each([
    [{ competencia: '08/2026' }],
    [{ competencia: '2026-08' }],
    [{ competencia: '2026-08', documentos: ['123'] }],
    [{ competencia: '2026-08', solicitadoPor: 'outro' }],
  ])('corpo inválido %j → 422 sem gravar', async (corpo) => {
    expect((await post(corpo)).status).toBe(422);
    expect(banco.log).toHaveLength(0);
  });

  it('não-JSON → 400', async () => {
    expect((await post('{x')).status).toBe(400);
  });

  it('sem papel → 403 sem tocar no banco', async () => {
    mockRequireRole.mockRejectedValue(new ApiError(403, 'Sem permissão', 'FORBIDDEN'));
    expect((await post({ competencia: '2026-08', documentos: ['08.293.377/0001-98'] })).status).toBe(403);
    expect(banco.log).toHaveLength(0);
  });
});

describe('GET iss-solicitacoes (AC 8)', () => {
  it('sem nada na competência → null', async () => {
    const r = await get('?competencia=2026-08');
    expect(r.status).toBe(200);
    expect(await r.json()).toBeNull();
  });

  it('devolve a ativa; sem ativa, a mais recente (ex.: concluída)', async () => {
    banco.tabelas.iss_solicitacoes!.push(
      solicitacaoRow({ id: 'antiga', status: 'falhou', solicitado_em: '2026-09-28T08:00:00.000Z' }),
      solicitacaoRow({ id: 'recente', status: 'concluida', solicitado_em: '2026-09-28T10:00:00.000Z' }),
    );
    expect((await (await get('?competencia=2026-08')).json()).id).toBe('recente');

    banco.tabelas.iss_solicitacoes!.push(
      solicitacaoRow({ id: 'ativa', status: 'em_andamento', solicitado_em: '2026-09-28T07:00:00.000Z' }),
    );
    expect((await (await get('?competencia=2026-08')).json()).id).toBe('ativa');
  });

  it.each(['', '?competencia=2026-13'])('competência inválida (%s) → 400', async (qs) => {
    expect((await get(qs)).status).toBe(400);
  });

  it('sem papel → 403; não cacheia', async () => {
    mockRequireRole.mockRejectedValue(new ApiError(403, 'Sem permissão', 'FORBIDDEN'));
    expect((await get('?competencia=2026-08')).status).toBe(403);
    expect(dynamic).toBe('force-dynamic');
  });
});

describe('POST iss-solicitacoes/[id]/cancelar (AC 9)', () => {
  it.each(['pendente', 'em_andamento'])('%s → 200 cancelada; a competência libera nova solicitação', async (status) => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status }));
    const r = await postCancelar(S1);
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('cancelada');
    expect((await post({ competencia: '2026-08', documentos: ['08.293.377/0001-98'] })).status).toBe(201);
  });

  it.each(['concluida', 'falhou', 'cancelada'])('%s → 422 (nada a cancelar)', async (status) => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status }));
    expect((await postCancelar(S1)).status).toBe(422);
  });

  it('id inválido ou inexistente → 404', async () => {
    expect((await postCancelar('abc')).status).toBe(404);
    expect((await postCancelar(S1)).status).toBe(404);
  });

  it('sem papel → 403 sem cancelar', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1 }));
    mockRequireRole.mockRejectedValue(new ApiError(403, 'Sem permissão', 'FORBIDDEN'));
    expect((await postCancelar(S1)).status).toBe(403);
    expect(banco.tabelas.iss_solicitacoes![0]!.status).toBe('pendente');
  });
});
