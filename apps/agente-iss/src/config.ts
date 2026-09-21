// Configuração do agente (Story 13.2 — arquitetura §7). Tudo que é segredo mora em
// %USERPROFILE%\agente-iss\.env, FORA do OneDrive: o repositório está no OneDrive, e um .env ali
// seria sincronizado para a nuvem junto com a senha da CEO.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ConfigAgente {
  pastaBase: string;
  issCpf: string;
  issSenha: string;
  /** Vazios no modo --offline (que não fala com o sistema). */
  token: string;
  sistemaUrl: string;
}

export class ErroConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroConfig';
  }
}

export function pastaBasePadrao(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENTE_ISS_HOME ?? join(homedir(), 'agente-iss');
}

/** KEY=VALOR por linha; ignora vazias e comentários; aceita valor entre aspas. */
export function lerArquivoEnv(conteudo: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const bruta of conteudo.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const i = linha.indexOf('=');
    if (i <= 0) continue;
    out[linha.slice(0, i).trim()] = linha.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export function validarConfig(
  pastaBase: string,
  vars: Record<string, string>,
  { apenasPortal = false }: { apenasPortal?: boolean } = {},
): ConfigAgente {
  if (/onedrive/i.test(pastaBase)) {
    throw new ErroConfig(
      `A pasta do agente (${pastaBase}) está dentro do OneDrive — a senha do ISS seria sincronizada para a nuvem. ` +
        'Use a pasta padrão (%USERPROFILE%\\agente-iss) ou defina AGENTE_ISS_HOME fora do OneDrive.',
    );
  }
  const obrigatorias = apenasPortal ? ['ISS_CPF', 'ISS_SENHA'] : ['ISS_CPF', 'ISS_SENHA', 'AGENTE_ISS_TOKEN', 'SISTEMA_URL'];
  const faltando = obrigatorias.filter((k) => !vars[k]);
  if (faltando.length > 0) {
    throw new ErroConfig(`Faltam no .env do agente: ${faltando.join(', ')}`);
  }
  const cpf = vars.ISS_CPF!.replace(/\D/g, '');
  if (cpf.length !== 11) throw new ErroConfig('ISS_CPF deve ter 11 dígitos');
  if (apenasPortal) return { pastaBase, issCpf: cpf, issSenha: vars.ISS_SENHA!, token: '', sistemaUrl: '' };
  if (vars.AGENTE_ISS_TOKEN!.length < 32) throw new ErroConfig('AGENTE_ISS_TOKEN parece incompleto (mínimo 32 caracteres)');
  const url = vars.SISTEMA_URL!.replace(/\/+$/, '');
  if (!/^https:\/\//.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) {
    throw new ErroConfig('SISTEMA_URL deve ser https:// (ou http://localhost para testes)');
  }
  return { pastaBase, issCpf: cpf, issSenha: vars.ISS_SENHA!, token: vars.AGENTE_ISS_TOKEN!, sistemaUrl: url };
}

export function carregarConfig(pastaBase = pastaBasePadrao(), opcoes: { apenasPortal?: boolean } = {}): ConfigAgente {
  const arquivo = join(pastaBase, '.env');
  if (!existsSync(arquivo)) {
    throw new ErroConfig(
      `Arquivo de configuração não encontrado: ${arquivo}\n` +
        'Crie-o com ISS_CPF, ISS_SENHA, AGENTE_ISS_TOKEN e SISTEMA_URL (ver apps/agente-iss/README.md).',
    );
  }
  return validarConfig(pastaBase, lerArquivoEnv(readFileSync(arquivo, 'utf8')), opcoes);
}
