'use client';
// Cards agregados + drill-down por médico — BI gerencial de inadimplência (feedback da CEO,
// 2026-08-17): "quem está inadimplente" precisava de nome + valor + boleto a boleto, e hoje só
// existia diluído na tabela "Por médico" (só a taxa %, sem lista acionável). Fica só na área
// interna autenticada — o BI PÚBLICO por link (RelatorioPublicoManager.tsx) nunca mostra nome de
// médico de propósito (LinkPublicoBI.tsx), então essa seção não pode vazar pra lá.
import { useState } from 'react';
import type { InadimplenteMedico, Recebivel } from '@cobranca/shared';
import { chaveMedico, diasEmAtraso } from '@/lib/inadimplencia';
import { EmptyState } from '@/components/ui/EmptyState';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Mesmas faixas de severidade do card "Aging de vencidos" já existente — não inventa uma nova escala. */
function badgeAtraso(dias: number): string {
  if (dias > 60) return 'badge-red';
  if (dias > 30) return 'badge-amber';
  return 'badge-slate';
}

export function InadimplenciaSection({ inadimplentes, vencidos }: { inadimplentes: InadimplenteMedico[]; vencidos: Recebivel[] }) {
  const [selecionado, setSelecionado] = useState<string | null>(null);

  if (inadimplentes.length === 0) {
    return <EmptyState title="Nenhum médico inadimplente" description="Não há boletos vencidos neste filtro." />;
  }

  const medicoSelecionado = inadimplentes.find((m) => chaveMedico(m) === selecionado) ?? null;
  const boletosDoSelecionado = medicoSelecionado
    ? vencidos.filter((r) => chaveMedico(r) === selecionado).sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? ''))
    : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {inadimplentes.map((m) => {
          const chave = chaveMedico(m);
          const ativo = chave === selecionado;
          return (
            <button
              key={chave}
              type="button"
              onClick={() => setSelecionado(ativo ? null : chave)}
              aria-expanded={ativo}
              className={`card flex flex-col gap-2 p-4 text-left transition-colors hover:border-cc-accent ${
                ativo ? 'border-cc-accent' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-medium text-cc-ink" title={m.nome}>{m.nome}</p>
                <span className="badge-slate shrink-0">{m.qtdVencidos}x</span>
              </div>
              <p className="tabular text-lg font-semibold text-cc-warning">{brl(m.totalVencido)}</p>
              <span className={`${badgeAtraso(m.diasAtrasoMax)} w-fit`}>
                {m.diasAtrasoMax === 0 ? 'vence hoje' : `${m.diasAtrasoMax}d de atraso`}
              </span>
            </button>
          );
        })}
      </div>

      {medicoSelecionado && (
        <div className="card overflow-x-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-cc-ink">Boletos vencidos · {medicoSelecionado.nome}</h3>
            <button type="button" onClick={() => setSelecionado(null)} className="text-2xs text-cc-muted hover:text-cc-ink">
              Fechar
            </button>
          </div>
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Competência</th>
                <th>Vencimento</th>
                <th className="text-right">Valor</th>
                <th className="text-right">Atraso</th>
              </tr>
            </thead>
            <tbody>
              {boletosDoSelecionado.map((r) => {
                const dias = r.vencimento ? diasEmAtraso(r.vencimento) : 0;
                return (
                  <tr key={r.boletoId}>
                    <td>{r.competencia}</td>
                    <td className="tabular">{r.vencimento ? new Date(`${r.vencimento}T00:00:00`).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="text-right tabular text-cc-warning">{brl(r.valor ?? 0)}</td>
                    <td className="text-right">
                      <span className={badgeAtraso(dias)}>{r.vencimento ? `${dias}d` : '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
