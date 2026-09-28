'use client';
// Botão "Buscar no ISS" + andamento da busca, no passo 1 do LoteContabilidadeDialog (Story 13.5,
// Épico 13 — Fase 2). Mesmo desenho de `PropostaIss.tsx`: só apresentação — o que mostrar e
// quando o agente "parece desligado" é decidido em `@/lib/solicitacao-iss` (funções puras); a
// consulta, o polling e as mutações ficam no diálogo.
import type { SolicitacaoIss } from '@cobranca/shared';
import {
  agentePareceDesligado,
  percentualSolicitacaoIss,
  solicitacaoAtiva,
  textoSolicitacaoIss,
  type TomSolicitacaoIss,
} from '@/lib/solicitacao-iss';

const COR_POR_TOM: Record<TomSolicitacaoIss, string> = {
  andamento: 'text-cc-ink-2',
  sucesso: 'text-cc-success',
  aviso: 'text-cc-warning',
  neutro: 'text-cc-muted',
};

export function SolicitacaoIssPainel({
  competencia,
  solicitacao,
  indisponivel,
  agora,
  pedindo,
  cancelando,
  onBuscar,
  onCancelar,
}: {
  competencia: string;
  /** `undefined` = ainda carregando; `null` = nunca houve busca pelo sistema nesta competência. */
  solicitacao: SolicitacaoIss | null | undefined;
  /** A consulta falhou (ex.: migration 0062 ainda não aplicada) — o passo 1 segue à mão. */
  indisponivel: boolean;
  agora: Date;
  pedindo: boolean;
  cancelando: boolean;
  onBuscar: () => void;
  onCancelar: (id: string) => void;
}) {
  if (indisponivel) {
    return (
      <p className="text-xs text-cc-muted">
        Não foi possível verificar as buscas no ISS pelo sistema — digite os valores ou rode o agente no
        computador do escritório.
      </p>
    );
  }

  const ativa = solicitacaoAtiva(solicitacao);
  const motivoDesabilitado = ativa
    ? `Já existe uma busca no ISS em andamento para ${competencia}`
    : solicitacao === undefined
      ? 'Verificando buscas no ISS…'
      : null;
  const situacao = solicitacao ? textoSolicitacaoIss(solicitacao) : null;
  const percentual = solicitacao ? percentualSolicitacaoIss(solicitacao) : null;
  const desligado = agentePareceDesligado(solicitacao, agora);

  return (
    <div className="space-y-2 rounded-lg border border-cc-hairline bg-cc-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBuscar}
          disabled={!!motivoDesabilitado || pedindo}
          title={motivoDesabilitado ?? `Pede ao computador do escritório que leia o faturamento de ${competencia} no ISS`}
          className="btn-secondary btn btn-sm"
        >
          {pedindo ? 'Pedindo…' : 'Buscar no ISS'}
        </button>
        {ativa && (
          <button
            type="button"
            onClick={() => onCancelar(solicitacao.id)}
            disabled={cancelando}
            className="btn-ghost btn btn-sm"
          >
            {cancelando ? 'Cancelando…' : 'Cancelar busca'}
          </button>
        )}
        {situacao && (
          <p
            role={ativa ? 'status' : undefined}
            aria-live={ativa ? 'polite' : undefined}
            className={`flex-1 text-xs ${COR_POR_TOM[situacao.tom]}`}
          >
            {ativa && <span className="live-dot mr-1.5 inline-block h-2 w-2 rounded-full bg-cc-accent" />}
            <span className="tabular">{situacao.texto}</span>
          </p>
        )}
      </div>
      {ativa && motivoDesabilitado && (
        <p className="text-2xs text-cc-muted">
          {motivoDesabilitado} — os campos que você não mexeu se preenchem sozinhos conforme a busca avança.
        </p>
      )}
      {percentual !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-cc-surface-2" aria-hidden="true">
          <div className="progress-fill h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(percentual, 4)}%` }} />
        </div>
      )}
      {desligado && (
        <p role="alert" className="alert-warning text-xs">
          O computador do escritório com o agente parece desligado — a busca não anda há mais de 3 minutos.
          Confira se ele está ligado, com a tarefa agendada instalada (ou o agente em modo vigiar).
        </p>
      )}
    </div>
  );
}
