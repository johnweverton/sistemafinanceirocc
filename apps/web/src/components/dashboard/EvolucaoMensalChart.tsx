'use client';
// Gráfico de evolução mensal — BI gerencial do Dashboard (feedback da CEO, 2026-08-17): visão
// de tendência ao longo do tempo que as barras/tabelas existentes não davam (elas só mostram a
// competência selecionada, uma de cada vez). Cores seguem os MESMOS tokens de status já usados
// nos cards de KPI da página (cc-success/cc-warning), nunca hues novas — consistência com o
// resto do Dashboard > paleta "ideal" isolada. Emitido fica em tom neutro (cc-ink-2): é o total
// bruto (superset de Recebido/Vencido/EmAberto), não uma identidade concorrente.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ResumoCompetencia } from '@cobranca/shared';
import { brl } from '@/lib/formato';

function brlCompacto(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
}

const SERIES = [
  { key: 'totalEmitido', label: 'Emitido', cor: 'rgb(var(--text-secondary))' },
  { key: 'totalRecebido', label: 'Recebido', cor: 'rgb(var(--success))' },
  { key: 'totalVencido', label: 'Vencido', cor: 'rgb(var(--warning))' },
] as const;

function TooltipCustom({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-3 py-2 shadow-cc-md">
      <p className="font-mono text-2xs uppercase tracking-wider text-cc-muted">{label}</p>
      <div className="mt-1 space-y-0.5">
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-cc-ink-2">{p.name}</span>
            <span className="tabular ml-auto font-medium text-cc-ink">{brl(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Evolução de Emitido/Recebido/Vencido ao longo das competências — ordenado cronologicamente. */
export function EvolucaoMensalChart({ dados }: { dados: ResumoCompetencia[] }) {
  const ordenado = [...dados].sort((a, b) => (a.competencia ?? '').localeCompare(b.competencia ?? ''));

  if (ordenado.length < 2) {
    return (
      <p className="text-sm text-cc-muted">Pelo menos 2 competências são necessárias para mostrar a evolução.</p>
    );
  }

  return (
    <div>
      <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={ordenado} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="competencia"
            stroke="rgb(var(--text-muted))"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: 'rgb(var(--border))' }}
          />
          <YAxis
            stroke="rgb(var(--text-muted))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={brlCompacto}
          />
          <Tooltip content={<TooltipCustom />} cursor={{ stroke: 'rgb(var(--border))', strokeWidth: 1 }} />
          <Legend
            formatter={(value) => <span className="text-xs text-cc-ink-2">{value}</span>}
            iconType="circle"
            iconSize={8}
          />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.cor}
              strokeWidth={2}
              strokeLinecap="round"
              dot={{ r: 3, fill: s.cor, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      </div>

      {/* Alternativa em tabela — acessibilidade (skill dataviz, check 6: "table view exists"). */}
      <details className="mt-2">
        <summary className="cursor-pointer text-2xs text-cc-muted hover:text-cc-ink-2">Ver como tabela</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Competência</th>
                <th className="text-right">Emitido</th>
                <th className="text-right">Recebido</th>
                <th className="text-right">Vencido</th>
              </tr>
            </thead>
            <tbody>
              {ordenado.map((c) => (
                <tr key={c.competencia}>
                  <td>{c.competencia}</td>
                  <td className="text-right tabular">{brl(c.totalEmitido)}</td>
                  <td className="text-right tabular text-cc-success">{brl(c.totalRecebido)}</td>
                  <td className="text-right tabular text-cc-warning">{brl(c.totalVencido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
