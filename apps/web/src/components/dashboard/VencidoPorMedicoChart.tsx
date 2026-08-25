'use client';
// Barra horizontal "quem deve mais" — BI gerencial (feedback da CEO, 2026-08-17). Série única
// (magnitude por médico), então usa 1 hue só (cc-warning, o mesmo tom já usado pro badge
// "Vencido" em RecebiveisManager.tsx) — sem gradiente/ramp, porque quem carrega a magnitude
// aqui é o COMPRIMENTO da barra, não a intensidade da cor.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { InadimplenteMedico } from '@cobranca/shared';
import { brl } from '@/lib/formato';

function brlCompacto(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
}

function TooltipCustom({ active, payload }: { active?: boolean; payload?: Array<{ payload: InadimplenteMedico }> }) {
  const m = active ? payload?.[0]?.payload : undefined;
  if (!m) return null;
  return (
    <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-3 py-2 shadow-cc-md">
      <p className="text-sm font-medium text-cc-ink">{m.nome}</p>
      <p className="tabular text-sm text-cc-warning">{brl(m.totalVencido)}</p>
      <p className="text-2xs text-cc-muted">{m.qtdVencidos} boleto(s) · atraso máx. {m.diasAtrasoMax}d</p>
    </div>
  );
}

/** Top N médicos por valor vencido, maior para menor (topo → base). */
export function VencidoPorMedicoChart({ dados, top = 8 }: { dados: InadimplenteMedico[]; top?: number }) {
  const recorte = dados.slice(0, top);
  const altura = Math.max(160, recorte.length * 40);

  if (recorte.length === 0) {
    return <p className="text-sm text-cc-muted">Nenhum médico com boletos vencidos neste filtro.</p>;
  }

  return (
    <div style={{ height: altura }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={recorte} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} barCategoryGap={8}>
          <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" stroke="rgb(var(--text-muted))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={brlCompacto} />
          <YAxis
            type="category"
            dataKey="nome"
            stroke="rgb(var(--text-muted))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={140}
            tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)}
          />
          <Tooltip content={<TooltipCustom />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
          <Bar dataKey="totalVencido" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {recorte.map((m) => (
              <Cell key={m.medicoId ?? m.nome} fill="rgb(var(--warning))" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
