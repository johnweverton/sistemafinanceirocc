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
  /** Story 13.5: atende pedidos do sistema web, consultando a cada 60 s. */
  vigiar: boolean;
  /** Story 13.5: atende no máximo um pedido do sistema e termina (tarefa agendada). */
  umaVez: boolean;
}

export class ErroArgs extends Error {}

// Story 13.4 (AC 7, 8): ajuda em camadas. O uso do dia a dia fica no topo; as flags de
// depuração (e o reenvio manual, que agora é automático) ficam em "Avançado". Nenhuma flag mudou
// de nome nem de comportamento.
export const AJUDA = `Agente de faturamento ISS Fortaleza (Épico 13)

Uso comum:
  npm run iss:faturamento                 modo assistente: pergunta a competência e confirma
                                          (fora de um terminal interativo, usa o mês anterior)
  npm run iss:faturamento -- --competencia AAAA-MM
                                          lê esta competência (padrão: mês anterior)
  npm run iss:configurar                  cria/atualiza a configuração (CPF, senha, token, URL)
  npm run iss:faturamento -- --ajuda      esta ajuda

  Envios que falharam são reenviados sozinhos no início da próxima execução.

Avançado (depuração):
  --cnpj 00000000000000   só este CPF/CNPJ (pode repetir)
  --limite N              no máximo N empresas (teste)
  --headed                mostra o navegador
  --reconhecer            salva HTML + print de cada passo
  --sem-envio             não envia ao sistema (só salva o JSON local)
  --offline               não fala com o sistema (exige --cnpj; só salva o JSON local)
                          — para validar a leitura do portal antes do sistema estar no ar
  --reenviar ARQUIVO      reenvia manualmente um JSON salvo, sem abrir o portal
  --vigiar                fica esperando os pedidos feitos no sistema (botão "Buscar no ISS")
                          e os executa; consulta a cada 60 s (Ctrl+C para parar)
  --uma-vez               atende no máximo UM pedido do sistema e termina — é o que a tarefa
                          agendada (scripts\\agente-iss\\instalar-tarefa-agendada.cmd) roda a cada minuto`;

/** Flags que não combinam com --vigiar/--uma-vez: a competência e as empresas vêm do pedido. */
const INCOMPATIVEIS_COM_VIGIAR = ['competencia', 'cnpj', 'limite', 'offline', 'sem-envio', 'reenviar'] as const;

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
        vigiar: { type: 'boolean', default: false },
        'uma-vez': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    throw new ErroArgs(`${(e as Error).message}\n\n${AJUDA}`);
  }

  // Story 13.5 (AC 15, 16): modos que atendem pedidos do sistema web.
  const vigiar = v.vigiar ?? false;
  const umaVez = v['uma-vez'] ?? false;
  if (vigiar && umaVez) throw new ErroArgs('Use --vigiar OU --uma-vez, não os dois.');
  if (vigiar || umaVez) {
    const conflito = INCOMPATIVEIS_COM_VIGIAR.find((k) => v[k] !== undefined && v[k] !== false);
    if (conflito) {
      throw new ErroArgs(
        `--${conflito} não combina com ${vigiar ? '--vigiar' : '--uma-vez'}: a competência e as empresas vêm do pedido feito no sistema.`,
      );
    }
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
    vigiar,
    umaVez,
  };
}
