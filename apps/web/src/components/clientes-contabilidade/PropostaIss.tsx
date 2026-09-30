'use client';
// Peças visuais da proposta do ISS no LoteContabilidadeDialog (Story 13.3, Épico 13):
// `SeloPropostaIss` (linha sob o campo de cada cliente) e `ResumoCapturaIss` (faixa acima da lista).
// Só apresentação — a decisão de pré-preencher e o texto do selo moram em `@/lib/proposta-iss`.
import type { UltimaExecucaoIss } from '@cobranca/shared';
import { classificacaoVisualIss, type EstadoPropostaIss, type TomSeloIss } from '@/lib/proposta-iss';

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

// Story 13.4 (AC 2, 3): o selo passou de ~7 variações em `text-2xs` com jargão do portal para 3
// estados com uma ação clara ("Veio do ISS" / "Confira" / "Digite à mão"). Texto e tom vêm de
// `classificacaoVisualIss` (função pura, testada sem renderizar); aqui só se escolhe a cor. O
// jargão técnico (situação do ISS, status bruto, horário) fica APENAS no `title` — hover/foco.
const COR_POR_TOM: Record<TomSeloIss, string> = {
  verde: 'text-cc-success',
  amarelo: 'text-cc-warning',
  cinza: 'text-cc-muted',
};

export function SeloPropostaIss({ estado }: { estado: EstadoPropostaIss }) {
  const selo = classificacaoVisualIss(estado);
  if (!selo) return null;
  return (
    <p
      className={`text-xs ${COR_POR_TOM[selo.tom]}`}
      title={selo.detalheTecnico ?? undefined}
      // Focável para o `title` também aparecer a quem navega por teclado (AC 2).
      tabIndex={selo.detalheTecnico ? 0 : undefined}
      data-tom={selo.tom}
    >
      <span className="font-semibold">{selo.rotulo}</span>
      {selo.motivo && <> · {selo.motivo}</>}
    </p>
  );
}

export function ResumoCapturaIss({
  ultimaExecucao,
  competenciaIss,
  manuais,
}: {
  ultimaExecucao: UltimaExecucaoIss | null;
  /**
   * Competência da escrituração lida no ISS (o mês anterior ao do lote). Fica VISÍVEL, não só no
   * `title`: o operador confere o valor na tela antes de lançar, e sem o mês de origem ele não tem
   * como saber que o número do lote de outubro é o faturamento de setembro.
   */
  competenciaIss: string;
  /** Nomes de quem o agente não entregou valor e precisa de digitação manual. */
  manuais: string[];
}) {
  if (!ultimaExecucao) {
    return (
      <p className="text-xs text-cc-muted">
        O agente do ISS ainda não leu o faturamento de <span className="tabular">{competenciaIss}</span> —
        digite os valores.
      </p>
    );
  }
  const t = ultimaExecucao.totais;
  return (
    <div className="text-xs text-cc-ink-2">
      <p>
        Faturamento lido no ISS da competência <strong className="tabular">{competenciaIss}</strong> (mês
        anterior ao do lote).
      </p>
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
