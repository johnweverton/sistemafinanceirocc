'use client';
// Gráfico de composição do DRE — melhoria de UX (feedback do dono, 2026-08-17): o relatório era
// só tabela; isso não substitui a lista de categorias abaixo (aprimora, mesmo espírito do
// Dashboard), só dá uma leitura visual rápida dos 4 grupos do período selecionado. Resultado
// líquido FICA DE FORA do gráfico de propósito — é derivado (Receita − os outros 3), não um 5º
// grupo somável junto deles; misturar os dois no mesmo eixo enganaria quem olha rápido.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { GrupoPlanoContas } from '@cobranca/shared';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function brlCompacto(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
}

// Receita entra, os outros 3 grupos saem — mesma semântica de cor já usada no resto do sistema
// (cc-success/cc-warning), não uma paleta categórica nova por grupo.
const COR_POR_GRUPO: Record<GrupoPlanoContas, string> = {
  receita: 'rgb(var(--success))',
  deducao_receita: 'rgb(var(--warning))',
  despesa_operacional: 'rgb(var(--warning))',
  despesa_financeira: 'rgb(var(--warning))',
};

export interface GrupoComposicao {
  grupo: GrupoPlanoContas;
  label: string;
  total: number;
}

function TooltipCustom({ active, payload }: { active?: boolean; payload?: Array<{ payload: GrupoComposicao }> }) {
  const g = active ? payload?.[0]?.payload : undefined;
  if (!g) return null;
  return (
    <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-3 py-2 shadow-cc-md">
      <p className="text-sm font-medium text-cc-ink">{g.label}</p>
      <p className="tabular text-sm text-cc-ink-2">{brl(g.total)}</p>
    </div>
  );
}

export function DreComposicaoChart({ grupos }: { grupos: GrupoComposicao[] }) {
  const altura = Math.max(120, grupos.length * 44);
  return (
    <div style={{ height: altura }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={grupos} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} barCategoryGap={10}>
          <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" stroke="rgb(var(--text-muted))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={brlCompacto} />
          <YAxis type="category" dataKey="label" stroke="rgb(var(--text-muted))" fontSize={12} tickLine={false} axisLine={false} width={150} />
          <Tooltip content={<TooltipCustom />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
          <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {grupos.map((g) => (
              <Cell key={g.grupo} fill={COR_POR_GRUPO[g.grupo]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
