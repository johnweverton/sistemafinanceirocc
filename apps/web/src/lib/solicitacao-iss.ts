// Estado de uma solicitação de busca no ISS para a tela (Story 13.5, Épico 13 — Fase 2).
// Lógica pura, no mesmo estilo de `proposta-iss.ts`: o `SolicitacaoIssPainel` só apresenta o que
// estas funções decidem (dá para testar sem renderizar nada).
import type { SolicitacaoIss } from '@cobranca/shared';
import type { EstadoPropostaIss } from './proposta-iss';

/** Sem sinal do agente por mais que isto ⇒ o computador do escritório parece desligado (AC 22). */
export const LIMITE_AGENTE_PARADO_MS = 3 * 60_000;

/** Intervalo do polling enquanto a solicitação está ativa (AC 20). */
export const INTERVALO_POLLING_SOLICITACAO_MS = 5_000;

/** `pendente`/`em_andamento` — a que ocupa a competência e bloqueia um novo pedido. */
export function solicitacaoAtiva(s: SolicitacaoIss | null | undefined): s is SolicitacaoIss {
  return !!s && (s.status === 'pendente' || s.status === 'em_andamento');
}

/**
 * AC 22: `pendente` há mais de 3 min (ninguém pegou o pedido) ou `em_andamento` com o sinal de
 * vida (heartbeat) parado há mais de 3 min. O agente reivindica a cada minuto e manda progresso a
 * cada empresa (~15 s), então 3 min sem nada é bem mais que o normal. Solicitação terminada nunca
 * acusa nada.
 */
export function agentePareceDesligado(s: SolicitacaoIss | null | undefined, agora: Date): boolean {
  if (!solicitacaoAtiva(s)) return false;
  const referencia = s.status === 'pendente' ? s.solicitadoEm : (s.heartbeatEm ?? s.iniciadoEm ?? s.solicitadoEm);
  const instante = Date.parse(referencia);
  if (Number.isNaN(instante)) return false;
  return agora.getTime() - instante > LIMITE_AGENTE_PARADO_MS;
}

function hora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function escopo(s: SolicitacaoIss): string {
  const n = s.documentos?.length ?? 0;
  return n > 0 ? ` (${n} empresa${n !== 1 ? 's' : ''})` : '';
}

export type TomSolicitacaoIss = 'andamento' | 'sucesso' | 'aviso' | 'neutro';

/** Uma linha dizendo em que pé está a busca — "Buscando no ISS… 34/90", "concluída às 10:42". */
export function textoSolicitacaoIss(s: SolicitacaoIss): { texto: string; tom: TomSolicitacaoIss } {
  switch (s.status) {
    case 'pendente':
      return {
        texto: `Na fila${escopo(s)} — aguardando o computador do escritório começar a busca no ISS…`,
        tom: 'andamento',
      };
    case 'em_andamento': {
      const temProgresso = s.progressoTotal !== null && s.progressoTotal > 0 && s.progressoAtual !== null;
      return {
        texto: `Buscando no ISS${escopo(s)}…${temProgresso ? ` ${s.progressoAtual}/${s.progressoTotal}` : ''}`,
        tom: 'andamento',
      };
    }
    case 'concluida':
      return { texto: `Busca no ISS${escopo(s)} concluída às ${hora(s.finalizadoEm)}.`, tom: 'sucesso' };
    case 'falhou':
      return {
        texto: `A busca no ISS${escopo(s)} falhou às ${hora(s.finalizadoEm)}${s.mensagemErro ? `: ${s.mensagemErro}` : '.'}`,
        tom: 'aviso',
      };
    case 'cancelada':
      return { texto: `Busca no ISS${escopo(s)} cancelada às ${hora(s.finalizadoEm)}.`, tom: 'neutro' };
  }
}

/** Percentual para a barra (0–100) ou `null` quando ainda não há total. */
export function percentualSolicitacaoIss(s: SolicitacaoIss): number | null {
  if (s.status !== 'em_andamento' || !s.progressoTotal || s.progressoAtual === null) return null;
  return Math.min(100, Math.round((s.progressoAtual / s.progressoTotal) * 100));
}

/**
 * AC 23: "Tentar de novo" só no cinza por falha que uma nova leitura pode resolver — empresa não
 * encontrada ou erro. `sem_escrituracao` é resposta legítima do portal (reler não muda nada).
 */
export function podeTentarDeNovoNoIss(estado: EstadoPropostaIss): boolean {
  return (
    estado.tipo === 'indisponivel' &&
    (estado.captura.status === 'nao_encontrado' || estado.captura.status === 'erro')
  );
}

/** CPF/CNPJ do cadastro (com ou sem máscara) → só dígitos, ou `null` se não der para buscar. */
export function documentoParaBuscaIss(pagadorDocumento: string | null | undefined): string | null {
  const digitos = (pagadorDocumento ?? '').replace(/\D/g, '');
  return digitos.length === 11 || digitos.length === 14 ? digitos : null;
}
