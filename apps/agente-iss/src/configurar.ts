// Comando `configurar` (Story 13.4, AC 13–14 — Épico 13).
//
// Antes: o `.env` do agente era criado à mão, copiando um bloco do README. Agora
// `npm run iss:configurar` pergunta CPF, senha (sem eco), token e URL, grava
// `%USERPROFILE%\agente-iss\.env` (ou `AGENTE_ISS_HOME`) e confere o token contra o sistema.
//
// Regras que NÃO são duplicadas aqui: a checagem de OneDrive, CPF, token e URL é a MESMA
// `validarConfig` de sempre — o arquivo só é escrito se ela passar. E `configurar` NUNCA faz
// login no portal do ISS (uma tentativa errada pode bloquear o usuário MASTER da CEO): a senha
// só é usada numa execução normal.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AlvosIssResposta } from '@cobranca/shared';
import { buscarAlvos, ErroApi } from './api-client';
import type { Escrever, Perguntar } from './assistente';
import { competenciaCorrente } from './competencia';
import { lerArquivoEnv, pastaBasePadrao, validarConfig, type ConfigAgente } from './config';

export interface ValoresConfig {
  cpf: string;
  senha: string;
  token: string;
  sistemaUrl: string;
}

/** Aspas duplas preservam espaços e `#` na senha; `lerArquivoEnv` tira só o par externo. */
function entreAspas(valor: string): string {
  return `"${valor}"`;
}

/** Conteúdo do `.env`, no mesmo formato que `lerArquivoEnv` lê. */
export function montarEnv(v: ValoresConfig): string {
  return [
    '# Configuração do agente ISS — gerada por `npm run iss:configurar` (Story 13.4).',
    '# NÃO copie este arquivo para dentro do OneDrive: ele contém a senha do ISS.',
    '# Login do perfil MASTER no ISS Fortaleza',
    `ISS_CPF=${v.cpf.replace(/\D/g, '')}`,
    `ISS_SENHA=${entreAspas(v.senha)}`,
    '# Token do agente (o hash dele fica na Vercel como AGENTE_ISS_TOKEN_SHA256)',
    `AGENTE_ISS_TOKEN=${v.token.trim()}`,
    `SISTEMA_URL=${v.sistemaUrl.trim().replace(/\/+$/, '')}`,
    '',
  ].join('\n');
}

/**
 * Monta o `.env` e roda a MESMA `validarConfig` do carregamento normal (inclusive a recusa de
 * pasta dentro do OneDrive). Lança `ErroConfig` sem escrever nada se algo não passar.
 */
export function prepararConfiguracao(pastaBase: string, v: ValoresConfig): { arquivo: string; conteudo: string; cfg: ConfigAgente } {
  const conteudo = montarEnv(v);
  const cfg = validarConfig(pastaBase, lerArquivoEnv(conteudo));
  return { arquivo: join(pastaBase, '.env'), conteudo, cfg };
}

export function gravarConfiguracao(pastaBase: string, v: ValoresConfig): ConfigAgente {
  const { arquivo, conteudo, cfg } = prepararConfiguracao(pastaBase, v); // valida ANTES de criar pasta/arquivo
  mkdirSync(pastaBase, { recursive: true });
  writeFileSync(arquivo, conteudo, { encoding: 'utf8', mode: 0o600 });
  return cfg;
}

export type ResultadoValidacaoToken =
  | { ok: true; mensagem: string }
  | { ok: false; mensagem: string };

/**
 * Confere token e URL com `GET /api/integracoes/iss/alvos?competencia=<mês atual>` (AC 14).
 * Só fala com o sistema — nunca com o portal do ISS.
 */
export async function validarToken(
  cfg: Pick<ConfigAgente, 'sistemaUrl' | 'token'>,
  buscar: (url: string, token: string, competencia: string) => Promise<AlvosIssResposta> = buscarAlvos,
  hoje: Date = new Date(),
): Promise<ResultadoValidacaoToken> {
  try {
    const r = await buscar(cfg.sistemaUrl, cfg.token, competenciaCorrente(hoje));
    return {
      ok: true,
      mensagem: `Token válido — o sistema respondeu e tem ${r.alvos.length} empresa(s) em faixa de faturamento para buscar.`,
    };
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) {
      return {
        ok: false,
        mensagem:
          'Token inválido: o sistema recusou o token (401). Ele não confere com AGENTE_ISS_TOKEN_SHA256 ' +
          'configurado na Vercel — confira com o responsável pelo sistema e rode `npm run iss:configurar` de novo.',
      };
    }
    return {
      ok: false,
      mensagem: `Não consegui confirmar o token: ${(e as Error).message}. Confira a URL do sistema (${cfg.sistemaUrl}) e a internet.`,
    };
  }
}

export interface DependenciasConfigurar {
  perguntar: Perguntar;
  perguntarSenha: Perguntar;
  escrever: Escrever;
  env?: NodeJS.ProcessEnv;
  buscar?: (url: string, token: string, competencia: string) => Promise<AlvosIssResposta>;
  hoje?: Date;
}

function lerExistente(pastaBase: string): Record<string, string> {
  const arquivo = join(pastaBase, '.env');
  if (!existsSync(arquivo)) return {};
  try {
    return lerArquivoEnv(readFileSync(arquivo, 'utf8'));
  } catch {
    return {};
  }
}

/** Pergunta com valor atual como padrão (Enter mantém). `mostrar` controla o que aparece. */
async function perguntarComPadrao(
  perguntar: Perguntar,
  texto: string,
  atual: string | undefined,
  mostrar: (v: string) => string = (v) => v,
): Promise<string> {
  const sufixo = atual ? ` (Enter mantém ${mostrar(atual)})` : '';
  const r = (await perguntar(`${texto}${sufixo}: `)).trim();
  return r || atual || '';
}

const mascarar = (v: string) => (v.length <= 8 ? '****' : `${v.slice(0, 4)}…${v.slice(-4)}`);

/**
 * Fluxo completo do `configurar`. Devolve o código de saída: 0 = gravado e token válido;
 * 1 = nada gravado (dado inválido/OneDrive); 3 = gravado, mas o token/URL não conferiu.
 */
export async function executarConfigurar(dep: DependenciasConfigurar): Promise<number> {
  const { perguntar, perguntarSenha, escrever } = dep;
  const pastaBase = pastaBasePadrao(dep.env ?? process.env);
  const atual = lerExistente(pastaBase);
  escrever('Configuração do agente ISS');
  escrever(`O arquivo será gravado em ${join(pastaBase, '.env')} (fora do OneDrive).`);
  escrever('A senha NÃO é testada no portal agora: ela só é usada quando o agente rodar de verdade.\n');

  const cpf = await perguntarComPadrao(perguntar, 'CPF do perfil MASTER no ISS (só números)', atual.ISS_CPF);
  const senhaDigitada = await perguntarSenha(
    `Senha do ISS (não aparece enquanto digita${atual.ISS_SENHA ? '; Enter mantém a atual' : ''}): `,
  );
  const senha = senhaDigitada || atual.ISS_SENHA || '';
  const token = await perguntarComPadrao(perguntar, 'Token do agente', atual.AGENTE_ISS_TOKEN, mascarar);
  const sistemaUrl = await perguntarComPadrao(perguntar, 'Endereço do sistema (ex.: https://cobrancacc.vercel.app)', atual.SISTEMA_URL);

  let cfg: ConfigAgente;
  try {
    cfg = gravarConfiguracao(pastaBase, { cpf, senha, token, sistemaUrl });
  } catch (e) {
    escrever(`\nNada foi gravado: ${(e as Error).message}`);
    return 1;
  }
  escrever(`\nConfiguração gravada em ${join(pastaBase, '.env')}.`);
  escrever('Conferindo o token com o sistema…');
  const v = await validarToken(cfg, dep.buscar, dep.hoje);
  escrever(v.mensagem);
  return v.ok ? 0 : 3;
}
