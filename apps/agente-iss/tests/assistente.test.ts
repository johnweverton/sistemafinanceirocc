// Modo assistente (Story 13.4, AC 9–11). As perguntas recebem respostas simuladas — sem TTY real,
// sem abrir navegador.
import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  confirmarInicio,
  criarTerminal,
  deveUsarAssistente,
  iniciarAssistente,
  interpretarCompetencia,
  interpretarSimNao,
  linkDoLote,
  oferecerAbrirLink,
  perguntarCompetencia,
} from '../src/assistente';

const hoje = new Date(2026, 8, 28); // 28/09/2026 → mês anterior = 2026-08

/** Simula o operador: cada pergunta consome a próxima resposta da fila. */
function operador(...respostas: string[]) {
  const perguntas: string[] = [];
  const fila = [...respostas];
  const perguntar = vi.fn(async (texto: string) => {
    perguntas.push(texto);
    return fila.shift() ?? '';
  });
  const saida: string[] = [];
  const escrever = (t: string) => saida.push(t);
  return { perguntar, escrever, perguntas, saida };
}

describe('deveUsarAssistente (AC 9, 10)', () => {
  it('sem argumentos em terminal interativo → assistente', () => {
    expect(deveUsarAssistente([], true)).toBe(true);
  });
  it('sem TTY (agendado/redirecionado) → não pergunta nada, usa os padrões de hoje', () => {
    expect(deveUsarAssistente([], false)).toBe(false);
    expect(deveUsarAssistente([], undefined)).toBe(false);
  });
  it('com qualquer flag → comportamento de sempre', () => {
    expect(deveUsarAssistente(['--competencia', '2026-08'], true)).toBe(false);
  });
});

describe('interpretarCompetencia', () => {
  it('Enter devolve o mês anterior (competenciaAnterior)', () => {
    expect(interpretarCompetencia('', hoje)).toBe('2026-08');
    expect(interpretarCompetencia('   ', hoje)).toBe('2026-08');
  });
  it('aceita AAAA-MM e MM/AAAA (grafia do portal)', () => {
    expect(interpretarCompetencia('2026-07', hoje)).toBe('2026-07');
    expect(interpretarCompetencia('07/2026', hoje)).toBe('2026-07');
    expect(interpretarCompetencia('7/2026', hoje)).toBe('2026-07');
  });
  it.each(['13/2026', '2026-13', 'agosto', '2026/08'])('rejeita %s', (r) => {
    expect(interpretarCompetencia(r, hoje)).toBeNull();
  });
});

describe('interpretarSimNao', () => {
  it.each([['', true], ['s', true], ['SIM', true], ['n', false], ['não', false], ['talvez', null]] as const)(
    '%j → %j',
    (r, esperado) => expect(interpretarSimNao(r)).toBe(esperado),
  );
});

describe('perguntarCompetencia / iniciarAssistente', () => {
  it('Enter usa o mês anterior e a pergunta mostra qual é', async () => {
    const o = operador('');
    expect(await iniciarAssistente(o.perguntar, o.escrever, hoje)).toBe('2026-08');
    expect(o.perguntas[0]).toContain('Enter = 08/2026');
  });

  it('valor digitado é usado', async () => {
    const o = operador('06/2026');
    expect(await perguntarCompetencia(o.perguntar, o.escrever, hoje)).toBe('2026-06');
  });

  it('resposta inválida pergunta de novo, com exemplo', async () => {
    const o = operador('junho', '2026-06');
    expect(await perguntarCompetencia(o.perguntar, o.escrever, hoje)).toBe('2026-06');
    expect(o.saida.join('\n')).toMatch(/Não entendi "junho"/);
  });

  it('três respostas inválidas → desiste sem fazer nada', async () => {
    const o = operador('x', 'y', 'z');
    expect(await iniciarAssistente(o.perguntar, o.escrever, hoje)).toBeNull();
    expect(o.saida.join('\n')).toMatch(/nada foi feito/);
  });
});

describe('confirmarInicio (AC 9)', () => {
  it('mostra competência, quantidade e tempo estimado; Enter confirma', async () => {
    const o = operador('');
    expect(await confirmarInicio(o.perguntar, o.escrever, '2026-08', 90)).toBe(true);
    expect(o.saida.join('\n')).toMatch(/08\/2026 de 90 empresa\(s\) — cerca de 23 minuto\(s\)/);
  });

  it('"n" cancela', async () => {
    const o = operador('n');
    expect(await confirmarInicio(o.perguntar, o.escrever, '2026-08', 2)).toBe(false);
    expect(o.saida.join('\n')).toMatch(/Cancelado/);
  });
});

describe('link de volta ao sistema (AC 11)', () => {
  it('linkDoLote aponta para o diálogo de lote da competência', () => {
    expect(linkDoLote('https://cobrancacc.vercel.app/', '2026-08')).toBe(
      'https://cobrancacc.vercel.app/clientes-contabilidade?lote=2026-08',
    );
  });

  it('aceitar abre o navegador com o link', async () => {
    const o = operador('s');
    const abrir = vi.fn();
    await oferecerAbrirLink(o.perguntar, o.escrever, 'https://x/clientes-contabilidade?lote=2026-08', abrir);
    expect(abrir).toHaveBeenCalledWith('https://x/clientes-contabilidade?lote=2026-08');
    expect(o.saida.join('\n')).toContain('https://x/clientes-contabilidade?lote=2026-08');
  });

  it('recusar só imprime o link', async () => {
    const o = operador('n');
    const abrir = vi.fn();
    await oferecerAbrirLink(o.perguntar, o.escrever, 'https://x/clientes-contabilidade?lote=2026-08', abrir);
    expect(abrir).not.toHaveBeenCalled();
    expect(o.saida.join('\n')).toContain('https://x/clientes-contabilidade?lote=2026-08');
  });

  it('não confirmar (respostas que não são sim/não) também só imprime', async () => {
    const o = operador('talvez', 'hmm', '?');
    const abrir = vi.fn();
    expect(await oferecerAbrirLink(o.perguntar, o.escrever, 'https://x', abrir)).toBe(false);
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe('criarTerminal', () => {
  it('perguntarSenha não ecoa o que é digitado', async () => {
    // Finge um terminal interativo: é nele que o readline ecoaria cada tecla.
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = new PassThrough();
    let escrito = '';
    output.on('data', (c: Buffer) => (escrito += c.toString()));
    const t = criarTerminal(input, output);

    const resposta = t.perguntarSenha('Senha: ');
    input.write('segredo123\n');
    expect(await resposta).toBe('segredo123');

    const nome = t.perguntar('Nome: ');
    input.write('Maria\n');
    expect(await nome).toBe('Maria');
    t.fechar();

    expect(escrito).toContain('Senha: ');
    expect(escrito).not.toContain('segredo123');
    expect(escrito).toContain('Maria'); // prova de que, fora da senha, o eco existe
  });

  it('entrada redirecionada: linhas que chegam antes da pergunta não se perdem; fim da entrada = Enter', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const t = criarTerminal(input, output);
    input.end('12345678901\nsenha\n');
    await new Promise((r) => setImmediate(r));

    expect(await t.perguntar('CPF: ')).toBe('12345678901');
    expect(await t.perguntarSenha('Senha: ')).toBe('senha');
    expect(await t.perguntar('Token: ')).toBe(''); // entrada acabou: não fica pendurado
    t.fechar();
  });
});
