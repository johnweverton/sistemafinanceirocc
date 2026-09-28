// Reenvio automático de envios que falharam (Story 13.4, AC 6). Pasta temporária real; o envio
// ao sistema é uma função mockada — nada de rede.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecucaoIssRegistrada, NovaExecucaoIss } from '@cobranca/shared';
import {
  ARQUIVO_MARCA_PENDENTE,
  enviarComMarca,
  listarEnviosPendentes,
  marcarEnvioPendente,
  reenviarPendentes,
  temEnvioPendente,
} from '../src/reenvio';

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agente-iss-reenvio-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function execucao(competencia = '2026-08'): NovaExecucaoIss {
  return {
    competencia,
    iniciadoEm: '2026-09-21T13:00:00.000Z',
    finalizadoEm: '2026-09-21T13:05:00.000Z',
    maquina: 'ESCRITORIO',
    versaoAgente: '0.1.0',
    capturas: [],
    ciencias: [],
  };
}

function registrada(competencia = '2026-08'): ExecucaoIssRegistrada {
  return {
    execucaoId: 'exec-1',
    competencia,
    totais: { capturado: 0, nao_encontrado: 0, sem_escrituracao: 0, erro: 0 },
    comAlerta: 0,
  };
}

/** Cria `<base>/execucoes/<pasta>/execucao.json`, opcionalmente com a marca de pendente. */
function criarExecucao(pasta: string, { pendente = false, competencia = '2026-08' } = {}): string {
  const dir = join(base, 'execucoes', pasta);
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, 'execucao.json');
  writeFileSync(arquivo, JSON.stringify(execucao(competencia)));
  if (pendente) marcarEnvioPendente(arquivo, 'Sem resposta do sistema');
  return arquivo;
}

describe('enviarComMarca', () => {
  it('falha no envio grava a marca ao lado do execucao.json e relança o erro', async () => {
    const arquivo = criarExecucao('20260921-130000-2026-08');
    const enviador = vi.fn().mockRejectedValue(new Error('Sistema respondeu 503'));

    await expect(enviarComMarca(arquivo, execucao(), enviador)).rejects.toThrow('503');

    expect(existsSync(join(base, 'execucoes', '20260921-130000-2026-08', ARQUIVO_MARCA_PENDENTE))).toBe(true);
  });

  it('sucesso remove a marca', async () => {
    const arquivo = criarExecucao('20260921-130000-2026-08', { pendente: true });
    await enviarComMarca(arquivo, execucao(), vi.fn().mockResolvedValue(registrada()));
    expect(temEnvioPendente(arquivo)).toBe(false);
  });
});

describe('listarEnviosPendentes', () => {
  it('sem pasta de execuções → nada pendente', () => {
    expect(listarEnviosPendentes(base)).toEqual([]);
  });

  it('encontra só as execuções marcadas, da mais antiga para a mais nova', () => {
    const nova = criarExecucao('20260922-090000-2026-08', { pendente: true });
    criarExecucao('20260921-100000-2026-08'); // enviada com sucesso: sem marca
    const antiga = criarExecucao('20260920-080000-2026-07', { pendente: true });
    // marca órfã (sem execucao.json) não é pendência reenviável
    mkdirSync(join(base, 'execucoes', 'quebrada'), { recursive: true });
    writeFileSync(join(base, 'execucoes', 'quebrada', ARQUIVO_MARCA_PENDENTE), 'x');

    expect(listarEnviosPendentes(base)).toEqual([antiga, nova]);
  });
});

describe('reenviarPendentes', () => {
  it('reenvia cada pendente com o JSON salvo e limpa a marca', async () => {
    const a = criarExecucao('20260920-080000-2026-07', { pendente: true, competencia: '2026-07' });
    const b = criarExecucao('20260921-080000-2026-08', { pendente: true, competencia: '2026-08' });
    const enviador = vi.fn().mockImplementation(async (e: NovaExecucaoIss) => registrada(e.competencia));

    const r = await reenviarPendentes(base, enviador, () => undefined);

    expect(enviador.mock.calls.map(([e]) => e.competencia)).toEqual(['2026-07', '2026-08']);
    expect(r.enviados).toHaveLength(2);
    expect(r.falhas).toEqual([]);
    expect(temEnvioPendente(a)).toBe(false);
    expect(temEnvioPendente(b)).toBe(false);
  });

  it('falha no reenvio NÃO lança: fica logada, a marca permanece e os outros seguem', async () => {
    const a = criarExecucao('20260920-080000-2026-07', { pendente: true, competencia: '2026-07' });
    const b = criarExecucao('20260921-080000-2026-08', { pendente: true, competencia: '2026-08' });
    const enviador = vi
      .fn()
      .mockRejectedValueOnce(new Error('Sem resposta do sistema'))
      .mockResolvedValueOnce(registrada());
    const log = vi.fn();

    const r = await reenviarPendentes(base, enviador, log);

    expect(r.falhas).toEqual([{ arquivo: a, erro: 'Sem resposta do sistema' }]);
    expect(r.enviados.map((x) => x.arquivo)).toEqual([b]);
    expect(temEnvioPendente(a)).toBe(true);
    expect(temEnvioPendente(b)).toBe(false);
    expect(log.mock.calls.flat().join('\n')).toMatch(/próxima execução/);
  });

  it('JSON ilegível conta como falha e mantém a marca', async () => {
    const a = criarExecucao('20260920-080000-2026-07', { pendente: true });
    writeFileSync(a, '{ quebrado');
    const enviador = vi.fn();

    const r = await reenviarPendentes(base, enviador, () => undefined);

    expect(enviador).not.toHaveBeenCalled();
    expect(r.falhas).toHaveLength(1);
    expect(temEnvioPendente(a)).toBe(true);
  });

  it('nada pendente → não chama o sistema nem loga', async () => {
    criarExecucao('20260921-100000-2026-08');
    const enviador = vi.fn();
    const log = vi.fn();
    await reenviarPendentes(base, enviador, log);
    expect(enviador).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
