// Modo vigiar / execução agendada (Story 13.5, AC 15–18 — Épico 13, Fase 2).
//
// O operador pede "Buscar no ISS" no sistema web; a solicitação fica no banco. Aqui o agente,
// rodando sozinho na máquina do escritório, pergunta ao sistema se há o que fazer:
//   --vigiar  → processo contínuo: pergunta a cada 60 s;
//   --uma-vez → pergunta UMA vez, processa se houver e termina (para o Agendador de Tarefas do
//               Windows chamar a cada minuto — scripts/agente-iss/instalar-tarefa-agendada.cmd).
//
// Por solicitação: `executarCompetencia` (um login novo por solicitação — AC 18) com os documentos
// pedidos, progresso a cada empresa, `POST /execucoes` com `solicitacaoId` e, por fim,
// `POST .../concluir`. Qualquer coisa que impeça produzir a execução (senha recusada, portal fora)
// conclui com `{ erro }` — a solicitação nunca fica presa em `em_andamento` por culpa nossa (se o
// processo MORRER no meio, o heartbeat para e o sistema a entrega de novo após 10 min).
// A senha do ISS continua só no `.env` local (G4): nenhuma rota recebe credencial.
import type { ConclusaoSolicitacaoIss, ExecucaoIssRegistrada, NovaExecucaoIss, SolicitacaoIss } from '@cobranca/shared';
import { ErroApi } from './api-client';
import { ehRecusaDefinitiva } from './reenvio';
import type { OpcoesExecucaoCompetencia, ResultadoExecucaoCompetencia } from './executar-competencia';

export const INTERVALO_VIGIAR_MS = 60_000;

/** A solicitação deixou de estar em andamento no sistema (o operador cancelou) — parar a rodada. */
export class ErroSolicitacaoEncerrada extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroSolicitacaoEncerrada';
  }
}

export interface DependenciasVigiar {
  buscarProxima(): Promise<SolicitacaoIss | null>;
  enviarProgresso(solicitacaoId: string, atual: number, total: number): Promise<void>;
  /** Envia a execução (com `solicitacaoId`); em falha deixa a marca de reenvio no JSON local. */
  enviarExecucao(execucao: NovaExecucaoIss, arquivoJson: string): Promise<ExecucaoIssRegistrada>;
  concluir(solicitacaoId: string, conclusao: ConclusaoSolicitacaoIss): Promise<void>;
  executar(
    opcoes: Pick<OpcoesExecucaoCompetencia, 'competencia' | 'documentos' | 'onProgresso'>,
  ): Promise<ResultadoExecucaoCompetencia>;
  /** Reenvio das execuções que falharam antes (Story 13.4) — nunca lança. */
  reenviarPendentes(): Promise<unknown>;
  esperar(ms: number): Promise<void>;
  log(msg: string): void;
  /** Remove dado sensível (CPF do login) de mensagens que vão ao sistema. */
  redigir?(msg: string): string;
}

export type DesfechoSolicitacao = 'concluida' | 'falhou' | 'cancelada';

const LIMITE_MENSAGEM = 1000; // mesmo teto do schema de `concluir`

async function concluirComTentativa(
  deps: DependenciasVigiar,
  id: string,
  conclusao: ConclusaoSolicitacaoIss,
): Promise<void> {
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    try {
      await deps.concluir(id, conclusao);
      return;
    } catch (e) {
      if (e instanceof ErroApi && e.status === 409) {
        deps.log(`A solicitação ${id} já não estava em andamento no sistema (${e.message}).`);
        return;
      }
      if (tentativa === 2) {
        deps.log(
          `Não consegui avisar o sistema do fim da solicitação ${id}: ${(e as Error).message}. ` +
            'Ela será entregue de novo automaticamente em ~10 minutos.',
        );
      }
    }
  }
}

/** Processa UMA solicitação já reivindicada (status `em_andamento` no sistema). */
export async function processarSolicitacao(s: SolicitacaoIss, deps: DependenciasVigiar): Promise<DesfechoSolicitacao> {
  const redigir = deps.redigir ?? ((m: string) => m);
  const escopo = s.documentos?.length ? `${s.documentos.length} empresa(s): ${s.documentos.join(', ')}` : 'carteira inteira';
  deps.log(`Solicitação ${s.id}: competência ${s.competencia} (${escopo}).`);

  const falhar = async (motivo: string): Promise<DesfechoSolicitacao> => {
    const erro = redigir(motivo).slice(0, LIMITE_MENSAGEM);
    deps.log(`Solicitação ${s.id} falhou: ${erro}`);
    await concluirComTentativa(deps, s.id, { erro });
    return 'falhou';
  };

  await deps.reenviarPendentes();

  let resultado: ResultadoExecucaoCompetencia;
  try {
    resultado = await deps.executar({
      competencia: s.competencia,
      documentos: s.documentos ?? [],
      onProgresso: async ({ atual, total }) => {
        try {
          await deps.enviarProgresso(s.id, atual, total);
        } catch (e) {
          // 409 = cancelada (ou encerrada) no sistema: parar. Falha de rede NÃO interrompe uma
          // leitura de 20 minutos — só o progresso da tela fica atrasado.
          if (e instanceof ErroApi && e.status === 409) throw new ErroSolicitacaoEncerrada(e.message);
          deps.log(`  (não consegui atualizar o progresso no sistema: ${(e as Error).message})`);
        }
      },
    });
  } catch (e) {
    if (e instanceof ErroSolicitacaoEncerrada) {
      deps.log(`Solicitação ${s.id} foi cancelada no sistema — parei a leitura (o parcial ficou salvo localmente).`);
      return 'cancelada';
    }
    return falhar((e as Error).message || String(e));
  }

  if (!resultado.execucao) {
    const detalhe = resultado.avisos.length ? ` ${resultado.avisos.join(' ')}` : '';
    return falhar(`Nenhuma empresa para buscar nesta solicitação.${detalhe}`);
  }

  let registrada: ExecucaoIssRegistrada;
  try {
    registrada = await deps.enviarExecucao({ ...resultado.execucao, solicitacaoId: s.id }, resultado.arquivoJson);
  } catch (e) {
    // QA 13.4/13.5: recusa definitiva (ex.: operador cancelou entre o último progresso e o envio)
    // não entra na fila de reenvio — dizer que "será reenviado" seria mentira.
    return falhar(
      ehRecusaDefinitiva(e)
        ? `A leitura terminou, mas o sistema recusou o resultado (${(e as Error).message}). ` +
            'Nada foi gravado; o resultado ficou só no computador do escritório.'
        : `A leitura terminou, mas o envio ao sistema falhou (${(e as Error).message}). ` +
            'O resultado ficou salvo no computador do escritório e será reenviado sozinho na próxima execução.',
    );
  }
  await concluirComTentativa(deps, s.id, { execucaoId: registrada.execucaoId });
  const t = registrada.totais;
  deps.log(
    `Solicitação ${s.id} concluída (execução ${registrada.execucaoId}): ${t.capturado} capturados, ` +
      `${t.nao_encontrado} não encontrados, ${t.sem_escrituracao} sem escrituração, ${t.erro} com erro.`,
  );
  return 'concluida';
}

export interface OpcoesVigiar {
  /** `true` = `--uma-vez`: uma consulta, processa se houver, termina. */
  umaVez: boolean;
  intervaloMs?: number;
  /** Para os testes (e um encerramento limpo): `false` encerra o laço antes do próximo ciclo. */
  continuar?: () => boolean;
}

/**
 * Laço do modo vigiar. Devolve o código de saída: 0 (nada a fazer / tudo certo), 1 (a última
 * solicitação processada falhou). Erro ao CONSULTAR o sistema nunca derruba o `--vigiar` — só
 * fica no log e o próximo ciclo tenta de novo; no `--uma-vez` vira código 1.
 */
export async function vigiar(opcoes: OpcoesVigiar, deps: DependenciasVigiar): Promise<number> {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_VIGIAR_MS;
  const continuar = opcoes.continuar ?? (() => true);
  if (!opcoes.umaVez) {
    deps.log(`Vigiando solicitações do sistema a cada ${Math.round(intervalo / 1000)} s (Ctrl+C para parar).`);
  }
  let codigo = 0;
  do {
    codigo = 0; // o código de saída reflete o ÚLTIMO ciclo
    let solicitacao: SolicitacaoIss | null = null;
    try {
      solicitacao = await deps.buscarProxima();
    } catch (e) {
      deps.log(`Não consegui consultar o sistema: ${(e as Error).message}`);
      codigo = 1;
    }
    if (solicitacao) {
      const desfecho = await processarSolicitacao(solicitacao, deps);
      codigo = desfecho === 'falhou' ? 1 : 0;
    } else if (opcoes.umaVez && codigo === 0) {
      deps.log('Nenhuma solicitação pendente.');
    }
    if (opcoes.umaVez) break;
    // Acabou de processar uma? Pergunta de novo já — pode haver outra na fila.
    if (!solicitacao && continuar()) await deps.esperar(intervalo);
  } while (continuar());
  return codigo;
}
