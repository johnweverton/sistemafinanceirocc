// Argumentos do CLI. Função pura (recebe argv e "hoje") para ser testável.
import { parseArgs } from 'node:util';
import { competenciaAnterior, competenciaValida } from './competencia';

export interface OpcoesCli {
  competencia: string;
  /** Filtra os alvos por CPF/CNPJ (só dígitos). Vazio = todos. */
  documentos: string[];
  limite: number | null;
  headed: boolean;
  /** Salva HTML+print de cada passo (diagnóstico de mudança no portal). */
  reconhecer: boolean;
  /** Não envia ao sistema — só lê e salva o JSON local. */
  semEnvio: boolean;
  /** Reenvia um JSON salvo, sem abrir o portal. */
  reenviar: string | null;
  /** Não fala com o sistema: alvos vêm de --cnpj, resultado só fica no JSON local. */
  offline: boolean;
  ajuda: boolean;
}

export class ErroArgs extends Error {}

export const AJUDA = `Agente de faturamento ISS Fortaleza (Épico 13)

Uso: npm run iss:faturamento -- [opções]

  --competencia AAAA-MM   competência a ler (padrão: mês anterior)
  --cnpj 00000000000000   só este CPF/CNPJ (pode repetir)
  --limite N              no máximo N empresas (teste)
  --headed                mostra o navegador
  --reconhecer            salva HTML + print de cada passo
  --sem-envio             não envia ao sistema (só salva o JSON local)
  --reenviar ARQUIVO      reenvia um JSON salvo, sem abrir o portal
  --offline               não fala com o sistema (exige --cnpj; só salva o JSON local)
                          — para validar a leitura do portal antes do sistema estar no ar
  --ajuda                 esta ajuda`;

export function lerOpcoes(argv: string[], hoje: Date = new Date()): OpcoesCli {
  let v;
  try {
    v = parseArgs({
      args: argv,
      options: {
        competencia: { type: 'string' },
        cnpj: { type: 'string', multiple: true },
        limite: { type: 'string' },
        headed: { type: 'boolean', default: false },
        reconhecer: { type: 'boolean', default: false },
        'sem-envio': { type: 'boolean', default: false },
        reenviar: { type: 'string' },
        offline: { type: 'boolean', default: false },
        ajuda: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    throw new ErroArgs(`${(e as Error).message}\n\n${AJUDA}`);
  }

  const competencia = v.competencia ?? competenciaAnterior(hoje);
  if (!competenciaValida(competencia)) throw new ErroArgs(`Competência inválida: "${competencia}" (use AAAA-MM)`);

  const documentos = (v.cnpj ?? []).map((d) => d.replace(/\D/g, ''));
  const invalido = documentos.find((d) => d.length !== 11 && d.length !== 14);
  if (invalido !== undefined) throw new ErroArgs(`CPF/CNPJ inválido em --cnpj: "${invalido}"`);

  const offline = v.offline ?? false;
  if (offline && documentos.length === 0) throw new ErroArgs('--offline exige ao menos um --cnpj');

  let limite: number | null = null;
  if (v.limite !== undefined) {
    if (!/^\d+$/.test(v.limite) || Number(v.limite) < 1) throw new ErroArgs('--limite deve ser um inteiro ≥ 1');
    limite = Number(v.limite);
  }

  return {
    competencia,
    documentos,
    limite,
    headed: v.headed ?? false,
    reconhecer: v.reconhecer ?? false,
    semEnvio: offline || (v['sem-envio'] ?? false),
    reenviar: v.reenviar ?? null,
    offline,
    ajuda: v.ajuda ?? false,
  };
}
