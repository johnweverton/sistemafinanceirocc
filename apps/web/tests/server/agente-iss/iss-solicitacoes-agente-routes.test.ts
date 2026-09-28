// Integração das rotas de MÁQUINA das solicitações do ISS (Story 13.5, AC 10–13): cada teste
// atravessa rota → guarda REAL do bearer token (só a env é dublê, como em
// require-agente-token.test.ts) → zod → repositório real → banco em memória (fake-supabase-iss).
// Inclui o fluxo completo operador → agente → operador, e o vínculo `solicitacaoId` em
// POST /api/integracoes/iss/execucoes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { criarBanco, criarSupabaseFake, solicitacaoRow, type FakeBanco } from './fake-supabase-iss';

const TOKEN = 'b'.repeat(64);
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({ AGENTE_ISS_TOKEN_SHA256: createHash('sha256').update(TOKEN).digest('hex') }),
  publicEnv: {},
}));

let banco: FakeBanco;
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => criarSupabaseFake(banco) }));

const CLIENTE = '22222222-2222-4222-8222-222222222222';
vi.mock('@/server/repositories/cliente-contabilidade-repository', () => ({
  listarClientesContabilidade: vi.fn(async () => []),
  listarClientesContabilidadePorIds: vi.fn(async (ids: string[]) =>
    ids.map((id) => ({ id, nome: 'Cliente', modoCobranca: 'faixa_faturamento', ativo: true })),
  ),
}));

// Rotas do operador só entram no teste do fluxo completo; a sessão é dublê (depende do Supabase Auth).
const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({ requireRole: (...a: unknown[]) => mockRequireRole(...a) }));

import { GET as proxima } from '@/app/api/integracoes/iss/solicitacoes/proxima/route';
import { POST as progresso } from '@/app/api/integracoes/iss/solicitacoes/[id]/progresso/route';
import { POST as concluir } from '@/app/api/integracoes/iss/solicitacoes/[id]/concluir/route';
import { POST as execucoes } from '@/app/api/integracoes/iss/execucoes/route';
import {
  GET as consultarDoOperador,
  POST as pedirDoOperador,
} from '@/app/api/clientes-contabilidade/faturamentos/iss-solicitacoes/route';

const S1 = '33333333-3333-4333-8333-333333333333';
const USUARIO = '00000000-0000-4000-8000-0000000000aa';
const semParams = { params: {} as Record<string, never> };
const comId = (id: string) => ({ params: { id } });
const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function req(url: string, init: { metodo?: string; corpo?: unknown; token?: string | null } = {}) {
  const headers = new Headers();
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return new Request(`http://test${url}`, {
    method: init.metodo ?? (init.corpo === undefined ? 'GET' : 'POST'),
    headers,
    body: init.corpo === undefined ? undefined : typeof init.corpo === 'string' ? init.corpo : JSON.stringify(init.corpo),
  });
}

const linha = (id: string) => banco.tabelas.iss_solicitacoes!.find((s) => s.id === id)!;
const escritas = () => banco.log.filter((l) => l.op !== 'select');

function execucaoPayload(over: Record<string, unknown> = {}) {
  return {
    competencia: '2026-08',
    iniciadoEm: '2026-09-28T10:00:00-03:00',
    finalizadoEm: '2026-09-28T10:20:00-03:00',
    maquina: 'ESCRITORIO-01',
    versaoAgente: '0.1.0',
    capturas: [
      {
        clienteContabilidadeId: CLIENTE,
        status: 'capturado',
        valorServicosPrestados: 618.84,
        quantidadeNotas: 3,
        situacaoIss: 'Fechada - Normal',
        competenciaFechada: true,
        inscricaoMunicipal: null,
        razaoSocialIss: null,
        mensagemErro: null,
        capturadoEm: '2026-09-28T10:01:00-03:00',
      },
    ],
    ciencias: [],
    ...over,
  };
}

beforeEach(() => {
  banco = criarBanco();
  mockRequireRole.mockReset();
  mockRequireRole.mockResolvedValue({ userId: USUARIO, papel: 'colaborador' });
});

describe('token do agente (AC 10–12)', () => {
  it.each([
    ['sem token', null],
    ['token errado', 'c'.repeat(64)],
  ])('%s → 401 nas três rotas, sem tocar no banco', async (_nome, token) => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento' }));
    const r1 = await proxima(req('/api/integracoes/iss/solicitacoes/proxima', { token }), semParams);
    const r2 = await progresso(req(`/x/${S1}/progresso`, { token, corpo: { atual: 1, total: 2 } }), comId(S1));
    const r3 = await concluir(req(`/x/${S1}/concluir`, { token, corpo: { erro: 'x' } }), comId(S1));
    expect([r1.status, r2.status, r3.status]).toEqual([401, 401, 401]);
    expect(banco.log).toHaveLength(0);
  });

  it('o token do agente NÃO vale nas rotas do operador (lá é sessão)', async () => {
    mockRequireRole.mockRejectedValue(Object.assign(new Error('Não autenticado'), { status: 401 }));
    const r = await pedirDoOperador(req('/x', { corpo: { competencia: '2026-08' } }), semParams);
    expect(r.status).toBe(401);
    expect(banco.log).toHaveLength(0);
  });
});

describe('GET /api/integracoes/iss/solicitacoes/proxima (AC 10)', () => {
  it('sem candidata → 204 sem corpo', async () => {
    const r = await proxima(req('/api/integracoes/iss/solicitacoes/proxima'), semParams);
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
  });

  it('reivindica a pendente mais antiga, com a máquina informada', async () => {
    banco.tabelas.iss_solicitacoes!.push(
      solicitacaoRow({ id: 'nova', competencia: '2026-09', solicitado_em: minutosAtras(1) }),
      solicitacaoRow({ id: S1, competencia: '2026-08', solicitado_em: minutosAtras(5), documentos: ['08293377000198'] }),
    );
    const r = await proxima(req('/api/integracoes/iss/solicitacoes/proxima?maquina=ESCRITORIO-01'), semParams);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({
      id: S1,
      status: 'em_andamento',
      maquina: 'ESCRITORIO-01',
      documentos: ['08293377000198'],
    });
    expect(corpo.heartbeatEm).toBeTruthy();
    expect(corpo.iniciadoEm).toBeTruthy();
    expect(linha('nova').status).toBe('pendente');
  });

  it('retoma em_andamento com heartbeat parado > 10 min; recente → 204', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento', heartbeat_em: minutosAtras(3) }));
    expect((await proxima(req('/api/integracoes/iss/solicitacoes/proxima'), semParams)).status).toBe(204);

    linha(S1).heartbeat_em = minutosAtras(15);
    const r = await proxima(req('/api/integracoes/iss/solicitacoes/proxima?maquina=OUTRA'), semParams);
    expect(r.status).toBe(200);
    expect((await r.json()).maquina).toBe('OUTRA');
  });

  it('chamar de novo logo depois não devolve a mesma (já está em andamento e viva)', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1 }));
    expect((await proxima(req('/api/integracoes/iss/solicitacoes/proxima'), semParams)).status).toBe(200);
    expect((await proxima(req('/api/integracoes/iss/solicitacoes/proxima'), semParams)).status).toBe(204);
  });
});

describe('POST /api/integracoes/iss/solicitacoes/[id]/progresso (AC 11)', () => {
  it('grava o progresso e renova o heartbeat', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento', heartbeat_em: minutosAtras(5) }));
    const r = await progresso(req(`/x`, { corpo: { atual: 34, total: 90 } }), comId(S1));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ progressoAtual: 34, progressoTotal: 90 });
    expect(String(linha(S1).heartbeat_em) > minutosAtras(1)).toBe(true);
  });

  it('cancelada pelo operador → 409 (o agente para)', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'cancelada' }));
    const r = await progresso(req(`/x`, { corpo: { atual: 1, total: 2 } }), comId(S1));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('SOLICITACAO_NAO_EM_ANDAMENTO');
  });

  it('pendente (ainda não reivindicada) → 409', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1 }));
    expect((await progresso(req(`/x`, { corpo: { atual: 1, total: 2 } }), comId(S1))).status).toBe(409);
  });

  it('corpo inválido → 422; não-JSON → 400; id inválido/inexistente → 404 — sem escrita', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento' }));
    expect((await progresso(req(`/x`, { corpo: { atual: 5, total: 2 } }), comId(S1))).status).toBe(422);
    expect((await progresso(req(`/x`, { corpo: '{nao-json' }), comId(S1))).status).toBe(400);
    expect((await progresso(req(`/x`, { corpo: { atual: 1, total: 2 } }), comId('abc'))).status).toBe(404);
    const inexistente = '44444444-4444-4444-8444-444444444444';
    expect((await progresso(req(`/x`, { corpo: { atual: 1, total: 2 } }), comId(inexistente))).status).toBe(404);
    expect(linha(S1).progresso_atual).toBeNull();
  });
});

describe('POST /api/integracoes/iss/solicitacoes/[id]/concluir (AC 12)', () => {
  it('{ erro } → falhou com a mensagem', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento' }));
    const r = await concluir(req(`/x`, { corpo: { erro: 'Login recusado pelo portal' } }), comId(S1));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'falhou', mensagemErro: 'Login recusado pelo portal' });
    expect(linha(S1).finalizado_em).toBeTruthy();
  });

  it('não em andamento → 409; os dois campos juntos → 422', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'concluida' }));
    expect((await concluir(req(`/x`, { corpo: { erro: 'x' } }), comId(S1))).status).toBe(409);
    const ambos = { execucaoId: S1, erro: 'x' };
    expect((await concluir(req(`/x`, { corpo: ambos }), comId(S1))).status).toBe(422);
    expect(linha(S1).status).toBe('concluida');
  });

  it('[QA] execucaoId de OUTRA competência → 422, solicitação continua em andamento', async () => {
    const EXEC = '66666666-6666-4666-8666-666666666666';
    banco.tabelas.iss_execucoes_agente!.push({ id: EXEC, competencia: '2026-07' });
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento', competencia: '2026-08' }));
    const r = await concluir(req(`/x`, { corpo: { execucaoId: EXEC } }), comId(S1));
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('EXECUCAO_OUTRA_COMPETENCIA');
    expect(linha(S1)).toMatchObject({ status: 'em_andamento', execucao_id: null });
  });

  it('execucaoId que não existe → 422 (FK), solicitação continua em andamento', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento' }));
    const r = await concluir(req(`/x`, { corpo: { execucaoId: '55555555-5555-4555-8555-555555555555' } }), comId(S1));
    expect(r.status).toBe(422);
    expect(linha(S1).status).toBe('em_andamento');
  });
});

describe('POST /api/integracoes/iss/execucoes — vínculo solicitacaoId (AC 13)', () => {
  it('solicitação em andamento → 201; a execução NÃO conclui a solicitação (só guarda)', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento' }));
    const r = await execucoes(req('/api/integracoes/iss/execucoes', { corpo: execucaoPayload({ solicitacaoId: S1 }) }), semParams);
    expect(r.status).toBe(201);
    expect(banco.tabelas.iss_execucoes_agente).toHaveLength(1);
    expect(linha(S1).status).toBe('em_andamento');
    expect(linha(S1).execucao_id).toBeNull();
  });

  it.each(['pendente', 'cancelada', 'concluida', 'falhou'])(
    'solicitação %s → 422 sem gravar execução nem capturas',
    async (status) => {
      banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status }));
      const r = await execucoes(req('/x', { corpo: execucaoPayload({ solicitacaoId: S1 }) }), semParams);
      expect(r.status).toBe(422);
      expect((await r.json()).error.code).toBe('SOLICITACAO_INVALIDA');
      expect(escritas()).toHaveLength(0);
    },
  );

  it('[QA] solicitação de OUTRA competência → 422 sem gravar execução nem capturas', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento', competencia: '2026-07' }));
    const r = await execucoes(req('/x', { corpo: execucaoPayload({ solicitacaoId: S1 }) }), semParams);
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('SOLICITACAO_INVALIDA');
    expect(escritas()).toHaveLength(0);
  });

  it('solicitação inexistente → 422', async () => {
    const r = await execucoes(req('/x', { corpo: execucaoPayload({ solicitacaoId: S1 }) }), semParams);
    expect(r.status).toBe(422);
    expect(escritas()).toHaveLength(0);
  });

  it('sem solicitacaoId (CLI de linha de comando) continua igual: 201 sem olhar solicitações', async () => {
    const r = await execucoes(req('/x', { corpo: execucaoPayload() }), semParams);
    expect(r.status).toBe(201);
    expect(banco.log.some((l) => l.tabela === 'iss_solicitacoes')).toBe(false);
  });
});

describe('[QA] POST /api/integracoes/iss/execucoes — idempotência por chaveIdempotencia', () => {
  const CHAVE = '44444444-4444-4444-8444-444444444444';

  it('mesma chave duas vezes (resposta perdida + reenvio) → mesma execução, sem duplicar capturas', async () => {
    const r1 = await execucoes(req('/x', { corpo: execucaoPayload({ chaveIdempotencia: CHAVE }) }), semParams);
    const r2 = await execucoes(req('/x', { corpo: execucaoPayload({ chaveIdempotencia: CHAVE }) }), semParams);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const [b1, b2] = [await r1.json(), await r2.json()];
    expect(b2).toEqual(b1);
    expect(banco.tabelas.iss_execucoes_agente).toHaveLength(1);
    expect(banco.tabelas.iss_capturas).toHaveLength(1);
    expect(banco.tabelas.iss_execucoes_agente![0]!.chave_idempotencia).toBe(CHAVE);
  });

  it('reenvio de execução que atendeu solicitação já CONCLUÍDA → devolve a gravada (não 422)', async () => {
    banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: S1, status: 'em_andamento', heartbeat_em: minutosAtras(1) }));
    const corpo = execucaoPayload({ solicitacaoId: S1, chaveIdempotencia: CHAVE });
    const r1 = await execucoes(req('/x', { corpo }), semParams);
    const { execucaoId } = await r1.json();
    const fim = await concluir(req(`/s/${S1}/concluir`, { corpo: { execucaoId } }), comId(S1));
    expect(fim.status).toBe(200);
    expect(linha(S1).status).toBe('concluida');

    const r2 = await execucoes(req('/x', { corpo }), semParams);
    expect(r2.status).toBe(201);
    expect((await r2.json()).execucaoId).toBe(execucaoId);
    expect(banco.tabelas.iss_execucoes_agente).toHaveLength(1);
  });

  it('corrida: a chave some da consulta mas o índice único pega → devolve a primeira', async () => {
    let inserts = 0;
    banco.antesDe = (op, tabela) => {
      // Simula o outro envio gravando ENTRE a consulta e o insert deste.
      if (op === 'insert' && tabela === 'iss_execucoes_agente' && inserts++ === 0) {
        banco.tabelas.iss_execucoes_agente!.push({
          id: '55555555-5555-4555-8555-555555555555',
          competencia: '2026-08',
          chave_idempotencia: CHAVE,
          totais: { capturado: 1, nao_encontrado: 0, sem_escrituracao: 0, erro: 0 },
        });
      }
    };
    const r = await execucoes(req('/x', { corpo: execucaoPayload({ chaveIdempotencia: CHAVE }) }), semParams);
    expect(r.status).toBe(201);
    expect((await r.json()).execucaoId).toBe('55555555-5555-4555-8555-555555555555');
    expect(banco.tabelas.iss_execucoes_agente).toHaveLength(1);
    expect(banco.tabelas.iss_capturas).toHaveLength(0);
  });

  it('mesma chave em outra competência → 422 sem gravar', async () => {
    await execucoes(req('/x', { corpo: execucaoPayload({ chaveIdempotencia: CHAVE }) }), semParams);
    const r = await execucoes(
      req('/x', { corpo: execucaoPayload({ chaveIdempotencia: CHAVE, competencia: '2026-07' }) }),
      semParams,
    );
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('CHAVE_IDEMPOTENCIA_CONFLITO');
    expect(banco.tabelas.iss_execucoes_agente).toHaveLength(1);
  });

  it('chave inválida (não-UUID) → 422 de validação', async () => {
    const r = await execucoes(req('/x', { corpo: execucaoPayload({ chaveIdempotencia: 'abc' }) }), semParams);
    expect(r.status).toBe(422);
  });

  it('sem chave (agente antigo) → cada envio grava, e a coluna nem é enviada', async () => {
    await execucoes(req('/x', { corpo: execucaoPayload() }), semParams);
    await execucoes(req('/x', { corpo: execucaoPayload() }), semParams);
    expect(banco.tabelas.iss_execucoes_agente).toHaveLength(2);
    expect(banco.tabelas.iss_execucoes_agente!.every((e) => !('chave_idempotencia' in e))).toBe(true);
  });
});

describe('fluxo completo: operador pede → agente executa → operador vê concluída', () => {
  it('pedido idempotente, reivindicação, progresso, execução vinculada e conclusão', async () => {
    const pedido = await pedirDoOperador(req('/x', { token: null, corpo: { competencia: '2026-08' } }), semParams);
    expect(pedido.status).toBe(201);
    const { id } = await pedido.json();
    const repetido = await pedirDoOperador(req('/x', { token: null, corpo: { competencia: '2026-08' } }), semParams);
    expect(repetido.status).toBe(200);
    expect((await repetido.json()).id).toBe(id);

    const reivindicada = await proxima(req('/api/integracoes/iss/solicitacoes/proxima?maquina=ESCRITORIO-01'), semParams);
    expect((await reivindicada.json()).id).toBe(id);

    for (const atual of [1, 2]) {
      expect((await progresso(req('/x', { corpo: { atual, total: 2 } }), comId(id))).status).toBe(200);
    }
    const emAndamento = await (await consultarDoOperador(req('/x?competencia=2026-08', { token: null }), semParams)).json();
    expect(emAndamento).toMatchObject({ status: 'em_andamento', progressoAtual: 2, progressoTotal: 2 });

    const exec = await execucoes(req('/x', { corpo: execucaoPayload({ solicitacaoId: id }) }), semParams);
    expect(exec.status).toBe(201);
    const { execucaoId } = await exec.json();
    expect((await concluir(req('/x', { corpo: { execucaoId } }), comId(id))).status).toBe(200);

    const final = await (await consultarDoOperador(req('/x?competencia=2026-08', { token: null }), semParams)).json();
    expect(final).toMatchObject({ id, status: 'concluida', execucaoId });
    expect((await proxima(req('/api/integracoes/iss/solicitacoes/proxima'), semParams)).status).toBe(204);
  });
});
