// Reenvio automático de execuções cujo envio falhou (Story 13.4, AC 6 — Épico 13).
//
// Antes: se o envio ao sistema falhava (rede, Vercel fora do ar, token), o CLI imprimia um
// comando com `--reenviar "<caminho>"` e dependia de alguém copiá-lo. Agora a falha deixa uma
// MARCA em disco (`envio-pendente`, ao lado do `execucao.json`) e toda execução normal começa
// tentando reenviar o que ficou pendente — antes de buscar qualquer alvo novo. Sucesso apaga a
// marca; falha a mantém para a próxima vez.
//
// Recusa DEFINITIVA (QA 13.4/13.5): se o sistema responde 4xx que não muda sozinho (422 dados
// inválidos, solicitação cancelada, cliente que saiu da faixa…), repetir para sempre não adianta.
// A marca vira `envio-recusado` (com o motivo), o JSON fica para análise e o agente para de tentar.
// Falha de rede, 5xx, 401/403 (token — conserta-se na configuração), 408 e 429 continuam pendentes.
// Reenvio duplicado também não é problema: a execução leva `chaveIdempotencia` e o servidor
// devolve a já gravada.
//
// Reenviar uma execução antiga NÃO sobrescreve capturas mais novas: o servidor escolhe a
// proposta vigente por `capturado_em` (`listarPropostasIssVigentes`), que vem do próprio JSON.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExecucaoIssRegistrada, NovaExecucaoIss } from '@cobranca/shared';
import { ErroApi } from './api-client';

export const ARQUIVO_MARCA_PENDENTE = 'envio-pendente';
export const ARQUIVO_MARCA_RECUSADO = 'envio-recusado';

/** O sistema recusou de vez: tentar de novo daria o mesmo resultado. */
export function ehRecusaDefinitiva(e: unknown): boolean {
  if (!(e instanceof ErroApi) || e.status === null) return false;
  return e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status);
}
export const ARQUIVO_EXECUCAO = 'execucao.json';

export type Enviador = (execucao: NovaExecucaoIss) => Promise<ExecucaoIssRegistrada>;

function caminhoMarca(arquivoExecucao: string): string {
  return join(dirname(arquivoExecucao), ARQUIVO_MARCA_PENDENTE);
}

/** Grava a marca ao lado do JSON. O conteúdo é só informativo (quando e por que falhou). */
export function marcarEnvioPendente(arquivoExecucao: string, motivo: string, agora: Date = new Date()): void {
  writeFileSync(caminhoMarca(arquivoExecucao), `${agora.toISOString()}\n${motivo}\n`);
}

export function limparEnvioPendente(arquivoExecucao: string): void {
  rmSync(caminhoMarca(arquivoExecucao), { force: true });
}

/** Troca a marca de pendente por recusado: a execução sai da fila de reenvio. */
export function marcarEnvioRecusado(arquivoExecucao: string, motivo: string, agora: Date = new Date()): void {
  limparEnvioPendente(arquivoExecucao);
  writeFileSync(join(dirname(arquivoExecucao), ARQUIVO_MARCA_RECUSADO), `${agora.toISOString()}\n${motivo}\n`);
}

export function foiRecusado(arquivoExecucao: string): boolean {
  return existsSync(join(dirname(arquivoExecucao), ARQUIVO_MARCA_RECUSADO));
}

export function temEnvioPendente(arquivoExecucao: string): boolean {
  return existsSync(caminhoMarca(arquivoExecucao));
}

/**
 * `execucao.json` de cada `<pastaBase>/execucoes/<pasta>/` que tem a marca de envio pendente, em
 * ordem de nome da pasta (o nome começa pelo carimbo de data-hora ⇒ mais antiga primeiro).
 */
export function listarEnviosPendentes(pastaBase: string): string[] {
  const raiz = join(pastaBase, 'execucoes');
  if (!existsSync(raiz)) return [];
  return readdirSync(raiz)
    .sort()
    .map((nome) => join(raiz, nome))
    .filter((pasta) => {
      try {
        return statSync(pasta).isDirectory();
      } catch {
        return false;
      }
    })
    .map((pasta) => join(pasta, ARQUIVO_EXECUCAO))
    .filter((arquivo) => existsSync(arquivo) && temEnvioPendente(arquivo));
}

/**
 * Envia e mantém a marca coerente: sucesso limpa, falha marca (e relança o erro — quem chama
 * decide como avisar o operador).
 */
export async function enviarComMarca(
  arquivoExecucao: string,
  execucao: NovaExecucaoIss,
  enviador: Enviador,
): Promise<ExecucaoIssRegistrada> {
  try {
    const registrada = await enviador(execucao);
    limparEnvioPendente(arquivoExecucao);
    return registrada;
  } catch (e) {
    if (ehRecusaDefinitiva(e)) marcarEnvioRecusado(arquivoExecucao, (e as Error).message);
    else marcarEnvioPendente(arquivoExecucao, (e as Error).message);
    throw e;
  }
}

export interface ResultadoReenvio {
  enviados: { arquivo: string; registrada: ExecucaoIssRegistrada }[];
  falhas: { arquivo: string; erro: string }[];
  /** Recusadas de vez pelo sistema (ou JSON ilegível): saíram da fila, não serão tentadas de novo. */
  recusados: { arquivo: string; erro: string }[];
}

/**
 * Tenta reenviar cada pendência encontrada. NUNCA lança: uma falha aqui fica logada e a marca
 * permanece, sem impedir a execução da competência atual (AC 6).
 */
export async function reenviarPendentes(
  pastaBase: string,
  enviador: Enviador,
  log: (msg: string) => void = console.log,
): Promise<ResultadoReenvio> {
  const resultado: ResultadoReenvio = { enviados: [], falhas: [], recusados: [] };
  const pendentes = listarEnviosPendentes(pastaBase);
  if (pendentes.length === 0) return resultado;
  log(`Encontrei ${pendentes.length} envio(s) que falharam antes — tentando reenviar primeiro.`);
  for (const arquivo of pendentes) {
    let execucao: NovaExecucaoIss;
    try {
      execucao = JSON.parse(readFileSync(arquivo, 'utf8')) as NovaExecucaoIss;
    } catch (e) {
      // JSON ilegível nunca vai passar: sai da fila e fica na pasta para análise.
      const erro = `execucao.json ilegível (${(e as Error).message})`;
      marcarEnvioRecusado(arquivo, erro);
      resultado.recusados.push({ arquivo, erro });
      log(`  não dá para reenviar ${arquivo}: ${erro} — deixei de tentar.`);
      continue;
    }
    try {
      const registrada = await enviarComMarca(arquivo, execucao, enviador);
      resultado.enviados.push({ arquivo, registrada });
      log(`  reenviado: competência ${execucao.competencia} (${arquivo})`);
    } catch (e) {
      const erro = (e as Error).message;
      if (foiRecusado(arquivo)) {
        resultado.recusados.push({ arquivo, erro });
        log(
          `  o sistema recusou ${arquivo}: ${erro} — deixei de tentar (o arquivo continua na pasta, ` +
            `com a marca ${ARQUIVO_MARCA_RECUSADO}).`,
        );
        continue;
      }
      resultado.falhas.push({ arquivo, erro });
      log(`  ainda não deu para reenviar ${arquivo}: ${erro} — tento de novo na próxima execução.`);
    }
  }
  return resultado;
}
