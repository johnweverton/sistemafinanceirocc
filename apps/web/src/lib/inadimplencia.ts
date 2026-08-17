// Agrupamento de inadimplência por médico — BI gerencial do Dashboard (feedback da CEO,
// 2026-08-17). Função pura, sem I/O: reusa o MESMO Recebivel já servido por /recebiveis
// (vw_recebiveis), mesmo padrão de relatorio-recebiveis.ts (server/engine) — só que client-safe
// (sem dependência de server/*), porque roda dentro do DashboardManager ('use client').
import type { Recebivel, InadimplenteMedico } from '@cobranca/shared';

/** Dias corridos entre uma data ISO (YYYY-MM-DD) e "hoje", sem hora — nunca negativo. */
export function diasEmAtraso(vencimentoIso: string, hoje: Date = new Date()): number {
  const venc = new Date(`${vencimentoIso}T00:00:00`);
  const hojeSemHora = new Date(`${hoje.toISOString().slice(0, 10)}T00:00:00`);
  return Math.max(0, Math.round((hojeSemHora.getTime() - venc.getTime()) / 86_400_000));
}

interface Acumulador {
  medicoId: string | null;
  nome: string;
  qtdVencidos: number;
  totalVencido: number;
  vencimentoMaisAntigo: string | null;
}

/**
 * Chave estável de agrupamento por médico — mesma regra usada aqui dentro E pelo drill-down da
 * UI (InadimplenciaSection.tsx), pra nunca divergir: exportada em vez de duplicada.
 */
export function chaveMedico(r: Pick<Recebivel, 'medicoId' | 'nome'>): string {
  return r.medicoId ?? `sem-medico:${r.nome}`;
}

/**
 * Agrupa recebíveis vencidos por médico, ordenado por total vencido decrescente (quem deve mais
 * primeiro). Ignora silenciosamente qualquer linha que não seja `statusDerivado === 'vencido'` —
 * quem chama passa a lista já filtrada, mas a função fica segura por si só (defesa em
 * profundidade, mesmo padrão de acumular() em relatorio-recebiveis.ts).
 */
export function agruparInadimplentesPorMedico(
  recebiveis: Recebivel[],
  hoje: Date = new Date(),
): InadimplenteMedico[] {
  const porMedico = new Map<string, Acumulador>();

  for (const r of recebiveis) {
    if (r.statusDerivado !== 'vencido') continue;
    const chave = chaveMedico(r);
    const atual = porMedico.get(chave) ?? {
      medicoId: r.medicoId,
      nome: r.nome,
      qtdVencidos: 0,
      totalVencido: 0,
      vencimentoMaisAntigo: null as string | null,
    };
    atual.qtdVencidos += 1;
    atual.totalVencido += r.valor ?? 0;
    if (r.vencimento && (!atual.vencimentoMaisAntigo || r.vencimento < atual.vencimentoMaisAntigo)) {
      atual.vencimentoMaisAntigo = r.vencimento;
    }
    porMedico.set(chave, atual);
  }

  return Array.from(porMedico.values())
    .map((a) => ({
      medicoId: a.medicoId,
      nome: a.nome,
      qtdVencidos: a.qtdVencidos,
      totalVencido: a.totalVencido,
      vencimentoMaisAntigo: a.vencimentoMaisAntigo,
      diasAtrasoMax: a.vencimentoMaisAntigo ? diasEmAtraso(a.vencimentoMaisAntigo, hoje) : 0,
    }))
    .sort((a, b) => b.totalVencido - a.totalVencido);
}
