'use client';
// Peças visuais da proposta do ISS no LoteContabilidadeDialog (Story 13.3, Épico 13):
// `SeloPropostaIss` (linha sob o campo de cada cliente) e `ResumoCapturaIss` (faixa acima da lista).
// Só apresentação — a decisão de pré-preencher mora em `@/lib/proposta-iss`.
import type { UltimaExecucaoIss } from '@cobranca/shared';
import type { EstadoPropostaIss } from '@/lib/proposta-iss';
import { brl } from '@/lib/formato';

function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function dataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${dataCurta(iso)} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function SeloPropostaIss({ estado }: { estado: EstadoPropostaIss }) {
  switch (estado.tipo) {
    case 'sem_captura':
      return null;
    case 'preenchivel':
      return estado.aberta ? (
        <p className="text-2xs text-cc-warning">
          ISS · competência aberta — o valor pode mudar até o fechamento
        </p>
      ) : (
        <p className="text-2xs text-cc-success">
          ISS · {estado.captura.situacaoIss ?? 'Fechada'} · capturado em {dataCurta(estado.captura.capturadoEm)}
        </p>
      );
    case 'alerta':
      return (
        <p role="alert" className="text-2xs text-cc-warning">
          ISS {brl(estado.valor)} · possível nota fora da escrituração — confira no portal antes de
          digitar
        </p>
      );
    case 'divergente':
      return (
        <p role="alert" className="text-2xs text-cc-warning">
          lançado {brl(estado.lancado)} · ISS {brl(estado.valor)}
        </p>
      );
    case 'confere':
      return (
        <p className="text-2xs text-cc-muted">
          lançado {brl(estado.lancado)} · confere com o ISS
        </p>
      );
    case 'indisponivel': {
      const motivo =
        estado.captura.status === 'nao_encontrado'
          ? 'empresa não encontrada no portal'
          : estado.captura.status === 'sem_escrituracao'
            ? 'sem escrituração nesta competência (não significa faturamento zero)'
            : 'falha na leitura do portal';
      return <p className="text-2xs text-cc-muted">ISS: {motivo} — digite manualmente</p>;
    }
  }
}

export function ResumoCapturaIss({
  ultimaExecucao,
  manuais,
}: {
  ultimaExecucao: UltimaExecucaoIss | null;
  /** Nomes de quem o agente não entregou valor e precisa de digitação manual. */
  manuais: string[];
}) {
  if (!ultimaExecucao) {
    return (
      <p className="text-xs text-cc-muted">
        O agente do ISS ainda não rodou para esta competência — digite os valores.
      </p>
    );
  }
  const t = ultimaExecucao.totais;
  return (
    <div className="text-xs text-cc-ink-2">
      <p>
        Última captura do ISS: <span className="tabular">{dataHora(ultimaExecucao.iniciadoEm)}</span> —{' '}
        <span className="tabular">{t.capturado}</span> capturado{t.capturado !== 1 ? 's' : ''} ·{' '}
        <span className="tabular">{t.nao_encontrado}</span> não encontrado
        {t.nao_encontrado !== 1 ? 's' : ''} · <span className="tabular">{t.sem_escrituracao}</span> sem
        escrituração · <span className="tabular">{t.erro}</span> erro{t.erro !== 1 ? 's' : ''}
      </p>
      {manuais.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-cc-muted">
            Precisam de digitação manual ({manuais.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {manuais.map((nome) => (
              <li key={nome}>{nome}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
