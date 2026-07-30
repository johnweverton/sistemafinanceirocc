'use client';
// Bloco de conciliação formal — adaptação do formato clássico de
// conciliação bancária (NBC TG 1000/03, skill `analisar-extrato-bancario`) ao nosso
// domínio: não existe "razão contábil" formal aqui — o equivalente é o total já
// CONCILIADO (auto+manual) no nosso sistema para o período. Cálculo 100% de leitura sobre
// dados já carregados pela tela /extrato (mesma query de saldo do dashboard, mesmas
// transações já filtradas por conta/período) — sem novo estado no banco, sem nova rota.
//
// Limitação assumida conscientemente: "saldo no extrato" vem de GET /api/contas/saldo,
// que é o saldo ATUAL da conta na Cora (a API não expõe saldo histórico por data) — não é
// literalmente "o saldo no fim do período" quando o período filtrado termina no passado.
// Rotulado de forma explícita para não confundir o usuário.
import { useQuery } from '@tanstack/react-query';
import type { ContaEmissora, ExtratoTransacaoComBoleto } from '@cobranca/shared';
import { contasService, contasQueryKeys } from '@/services/contas';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// "Não conciliadas" = ainda pendentes de decisão humana/automática (candidatas a
// depósito/pagamento em trânsito). `ignorado` fica de fora — já foi triado como
// irrelevante (tarifa, transferência interna...), não é mais uma pendência.
const NAO_CONCILIADOS = new Set(['sem_match', 'sugerido']);
const CONCILIADOS = new Set(['conciliado_auto', 'conciliado_manual']);

export function ConciliacaoResumo({
  conta,
  transacoes,
  periodo,
}: {
  conta: ContaEmissora;
  transacoes: ExtratoTransacaoComBoleto[];
  periodo: { inicio: string; fim: string };
}) {
  const { data: saldos } = useQuery({
    queryKey: contasQueryKeys.saldos(),
    queryFn: () => contasService.saldos(),
    staleTime: 60_000,
  });
  const saldoConta = saldos?.find((s) => s.conta === conta);

  const depositosEmTransito = transacoes
    .filter((t) => t.tipo === 'CREDIT' && NAO_CONCILIADOS.has(t.statusConciliacao))
    .reduce((soma, t) => soma + t.valor, 0);

  const pagamentosEmTransito = transacoes
    .filter((t) => t.tipo === 'DEBIT' && NAO_CONCILIADOS.has(t.statusConciliacao))
    .reduce((soma, t) => soma + t.valor, 0);

  // Soma líquida (crédito soma, débito subtrai) do que já foi processado — equivalente ao
  // "saldo contábil" do período: o quanto do movimento bancário já está vinculado a um
  // boleto ou confirmado manualmente.
  const totalConciliado = transacoes
    .filter((t) => CONCILIADOS.has(t.statusConciliacao))
    .reduce((soma, t) => soma + (t.tipo === 'CREDIT' ? t.valor : -t.valor), 0);

  const saldoExtrato = saldoConta?.saldo?.disponivel ?? null;
  const saldoAjustado =
    saldoExtrato != null ? saldoExtrato + depositosEmTransito - pagamentosEmTransito : null;

  return (
    <div className="card space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-cc-ink">Conciliação do período</h2>
        <p className="text-xs text-cc-muted">
          {periodo.inicio && periodo.fim ? `${periodo.inicio} a ${periodo.fim}` : 'Período selecionado'}
          {' · '}extrato ajustado por pendências × total já processado pelo sistema.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <dl className="space-y-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-cc-ink-2">Saldo atual da conta (Cora)</dt>
            <dd className="tabular font-medium text-cc-ink">
              {saldoExtrato != null ? brl(saldoExtrato) : '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-cc-ink-2">(+) Créditos não conciliados no período</dt>
            <dd className="tabular text-cc-success">{brl(depositosEmTransito)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-cc-ink-2">(−) Débitos não conciliados no período</dt>
            <dd className="tabular text-cc-danger">{brl(pagamentosEmTransito)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-cc-hairline pt-1 font-semibold">
            <dt className="text-cc-ink">(=) Saldo ajustado do extrato</dt>
            <dd className="tabular text-cc-ink">{saldoAjustado != null ? brl(saldoAjustado) : '—'}</dd>
          </div>
          <p className="text-2xs text-cc-muted">
            &ldquo;Saldo atual&rdquo; é o saldo de agora na Cora (a API não expõe histórico por
            data) — equivalente ao saldo do extrato quando o período termina hoje.
          </p>
        </dl>

        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-cc-ink-2">Total conciliado no sistema (auto + manual)</span>
            <span className="tabular font-medium text-cc-ink">{brl(totalConciliado)}</span>
          </div>
          <p className="text-2xs text-cc-muted">
            Equivalente ao &ldquo;razão contábil&rdquo; do período — soma líquida do que já foi
            vinculado a boletos ou confirmado manualmente. Não é diretamente comparável ao saldo
            da conta acima (que reflete o histórico completo da conta, não só o período filtrado).
          </p>
        </div>
      </div>
    </div>
  );
}
