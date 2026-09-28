// Modo assistente do CLI (Story 13.4, AC 9–11 — Épico 13).
//
// O operador não técnico não deveria decorar flags: rodando `npm run iss:faturamento` sem nada,
// num terminal interativo (ou pelo atalho da Área de Trabalho), o agente PERGUNTA a competência,
// confirma antes de abrir o portal e, no fim, oferece abrir o diálogo de lote no sistema. Sem TTY
// (agendado/redirecionado) nada é perguntado — comportamento idêntico ao de antes (AC 10).
//
// As perguntas recebem uma função `Perguntar` injetada: os testes simulam as respostas sem
// terminal real; o CLI usa `criarTerminal()` (node:readline).
import { spawn } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { competenciaAnterior, competenciaValida } from './competencia';

export type Perguntar = (texto: string) => Promise<string>;
export type Escrever = (texto: string) => void;

/** Assistente só sem nenhum argumento E em terminal interativo (AC 9, 10). */
export function deveUsarAssistente(argv: string[], stdinTty: boolean | undefined): boolean {
  return argv.length === 0 && stdinTty === true;
}

/**
 * Resposta do operador → competência. Enter = mês anterior; aceita `AAAA-MM` e também `MM/AAAA`
 * (a grafia do portal, que é a que o operador vê no ISS). `null` = resposta inválida.
 */
export function interpretarCompetencia(resposta: string, hoje: Date = new Date()): string | null {
  const r = resposta.trim();
  if (r === '') return competenciaAnterior(hoje);
  if (competenciaValida(r)) return r;
  const m = /^(\d{1,2})\/(\d{4})$/.exec(r);
  if (m) {
    const c = `${m[2]}-${m[1]!.padStart(2, '0')}`;
    return competenciaValida(c) ? c : null;
  }
  return null;
}

/** Sim/não com padrão SIM no Enter (o caminho normal é seguir em frente). */
export function interpretarSimNao(resposta: string): boolean | null {
  const r = resposta.trim().toLowerCase();
  if (r === '' || r === 's' || r === 'sim' || r === 'y' || r === 'yes') return true;
  if (r === 'n' || r === 'nao' || r === 'não' || r === 'no') return false;
  return null;
}

/** '2026-08' → '08/2026' (como o operador lê a competência). */
function mesAno(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  return `${mes}/${ano}`;
}

const MAX_TENTATIVAS = 3;

export async function perguntarCompetencia(perguntar: Perguntar, escrever: Escrever, hoje: Date = new Date()): Promise<string | null> {
  const padrao = competenciaAnterior(hoje);
  for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
    const resposta = await perguntar(`Qual competência buscar no ISS? (Enter = ${mesAno(padrao)}; ou digite MM/AAAA): `);
    const competencia = interpretarCompetencia(resposta, hoje);
    if (competencia) return competencia;
    escrever(`Não entendi "${resposta.trim()}". Digite o mês e o ano, por exemplo ${mesAno(padrao)}.`);
  }
  return null;
}

export async function perguntarSimNao(perguntar: Perguntar, escrever: Escrever, texto: string): Promise<boolean> {
  for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
    const r = interpretarSimNao(await perguntar(`${texto} [S/n]: `));
    if (r !== null) return r;
    escrever('Responda S (sim) ou N (não).');
  }
  return false; // sem resposta clara: não faz nada por conta própria
}

/** Pergunta inicial do assistente: competência. `null` = operador não conseguiu informar. */
export async function iniciarAssistente(perguntar: Perguntar, escrever: Escrever, hoje: Date = new Date()): Promise<string | null> {
  escrever('Agente de faturamento ISS Fortaleza — modo assistente');
  escrever('(para ver as opções avançadas: npm run iss:faturamento -- --ajuda)\n');
  const competencia = await perguntarCompetencia(perguntar, escrever, hoje);
  if (!competencia) escrever('Competência não informada — nada foi feito.');
  return competencia;
}

/** Confirmação antes de abrir o portal, já sabendo quantas empresas serão lidas (AC 9). */
export async function confirmarInicio(
  perguntar: Perguntar,
  escrever: Escrever,
  competencia: string,
  empresas: number,
): Promise<boolean> {
  const minutos = Math.max(1, Math.ceil((empresas * 15) / 60));
  escrever(
    `\nVou ler no ISS o faturamento de ${mesAno(competencia)} de ${empresas} empresa(s) — cerca de ${minutos} minuto(s).` +
      '\nO computador pode ser usado normalmente; não feche esta janela.',
  );
  const ok = await perguntarSimNao(perguntar, escrever, 'Começar agora?');
  if (!ok) escrever('Cancelado — nada foi lido nem enviado.');
  return ok;
}

/** Link do diálogo de lote daquela competência no sistema (AC 11). */
export function linkDoLote(sistemaUrl: string, competencia: string): string {
  return `${sistemaUrl.replace(/\/+$/, '')}/clientes-contabilidade?lote=${competencia}`;
}

/**
 * Fim do assistente: imprime o link e oferece abrir no navegador. Recusar (ou não confirmar) só
 * imprime o link (AC 11).
 */
export async function oferecerAbrirLink(
  perguntar: Perguntar,
  escrever: Escrever,
  link: string,
  abrir: (url: string) => void = abrirNoNavegador,
): Promise<boolean> {
  escrever(`\nPara conferir e lançar os valores, abra no sistema:\n  ${link}`);
  const ok = await perguntarSimNao(perguntar, escrever, 'Abrir agora no navegador?');
  if (ok) abrir(link);
  return ok;
}

/** Navegador padrão via `start` no Windows (AC 11); fora dele, só o link impresso já basta. */
export function abrirNoNavegador(url: string): void {
  if (process.platform !== 'win32') return;
  // `start` é embutido do cmd; o "" é o título da janela (sem ele, a URL viraria o título).
  // Argumentos literais: o Node escaparia as aspas de `""` e o cmd leria outra coisa.
  spawn('cmd', ['/c', `start "" "${url.replace(/"/g, '')}"`], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  }).unref();
}

export interface Terminal {
  perguntar: Perguntar;
  /** Pergunta sem ecoar o que é digitado (senha). */
  perguntarSenha: Perguntar;
  fechar: () => void;
}

/**
 * Terminal real (node:readline). Abrir/fechar em volta de cada bloco de perguntas: enquanto a
 * interface está aberta o stdin fica em modo raw e o Ctrl+C não chega ao processo como de costume.
 */
export function criarTerminal(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Terminal {
  const rl: Interface = createInterface({ input, output, terminal: Boolean((input as { isTTY?: boolean }).isTTY) });
  let mudo = false;
  // Único jeito de não ecoar com o readline nativo (sem dependência nova): silenciar a escrita
  // enquanto a senha é digitada. `_writeToOutput` é interno, mas estável há muitas versões do Node.
  const interno = rl as unknown as { _writeToOutput: (s: string) => void };
  const escreverOriginal = interno._writeToOutput.bind(rl);
  interno._writeToOutput = (s: string) => {
    if (!mudo) escreverOriginal(s);
  };
  // Fila de linhas em vez de `rl.question`: com entrada redirecionada (`echo ... | agente`), o
  // readline lê todas as linhas de uma vez e as que chegam sem pergunta pendente se perderiam.
  // Entrada encerrada responde '' (o mesmo que Enter) em vez de deixar a pergunta pendurada.
  const fila: string[] = [];
  const esperando: ((linha: string) => void)[] = [];
  let encerrado = false;
  rl.on('line', (linha) => {
    const w = esperando.shift();
    if (w) w(linha);
    else fila.push(linha);
  });
  rl.on('close', () => {
    encerrado = true;
    while (esperando.length) esperando.shift()!('');
  });
  const lerLinha = (): Promise<string> => {
    if (fila.length) return Promise.resolve(fila.shift()!);
    if (encerrado) return Promise.resolve('');
    return new Promise((resolve) => esperando.push(resolve));
  };
  const perguntar: Perguntar = (texto) => {
    if (encerrado) {
      output.write(texto); // readline fechado não aceita mais `prompt()`
    } else {
      rl.setPrompt(texto);
      rl.prompt();
    }
    return lerLinha();
  };
  return {
    perguntar,
    perguntarSenha: async (texto) => {
      output.write(texto);
      mudo = true;
      try {
        return await lerLinha();
      } finally {
        mudo = false;
        output.write('\n');
      }
    },
    fechar: () => rl.close(),
  };
}

/** Abre um terminal, roda as perguntas e fecha, mesmo em erro. */
export async function comTerminal<T>(fn: (t: Terminal) => Promise<T>): Promise<T> {
  const t = criarTerminal();
  try {
    return await fn(t);
  } finally {
    t.fechar();
  }
}
