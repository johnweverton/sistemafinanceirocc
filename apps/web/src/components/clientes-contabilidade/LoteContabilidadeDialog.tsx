'use client';
// Cálculo em lote de clientes contábeis (feedback do dono, 2026-08-20): hoje só existia emissão
// individual (1 cliente por vez), sem o ganho de produtividade que o lote de médico já dá. Fluxo:
//   1. (só se algum selecionado for `faixa_faturamento`) lança o faturamento da competência em
//      massa — sem isso o cálculo desses clientes fica em alerta, mesma regra de sempre.
//   2. Calcula o lote inteiro numa chamada só (POST /clientes-contabilidade/lote) — sem polling:
//      a rota AGUARDA o cálculo terminar antes de responder (mesmo padrão de POST /execucoes).
//   3. Emissão em lote dos boletos REAPROVEITA o mecanismo já existente (LoteEmissaoDialog) sem
//      nenhuma mudança nele — já é agnóstico de médico/empresa/cliente contábil.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClienteContabilidade } from '@cobranca/shared';
import { clientesContabilidadeService } from '@/services/clientes-contabilidade';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { LoteEmissaoDialog } from '@/components/execucoes/LoteEmissaoDialog';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

export function LoteContabilidadeDialog({
  clientes,
  onClose,
}: {
  /** Clientes JÁ selecionados na tela (resolvidos pelo chamador — nome/modoCobranca). */
  clientes: ClienteContabilidade[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [faturamentos, setFaturamentos] = useState<Record<string, string>>({});
  const [faturamentoLancado, setFaturamentoLancado] = useState(false);
  const [execucaoId, setExecucaoId] = useState<string | null>(null);
  const [mostrarEmissao, setMostrarEmissao] = useState(false);

  const faixaFaturamento = useMemo(() => clientes.filter((c) => c.modoCobranca === 'faixa_faturamento'), [clientes]);
  const precisaFaturamento = faixaFaturamento.length > 0 && !faturamentoLancado;

  const lancarFaturamentos = useMutation({
    mutationFn: () => {
      const lancamentos = faixaFaturamento
        .map((c) => ({ clienteContabilidadeId: c.id, faturamento: Number(faturamentos[c.id]) }))
        .filter((l) => faturamentos[l.clienteContabilidadeId]?.trim() && !Number.isNaN(l.faturamento) && l.faturamento >= 0);
      return clientesContabilidadeService.lancarFaturamentoLote(competencia, lancamentos);
    },
    onSuccess: (resultado) => {
      setFaturamentoLancado(true);
      if (resultado.falhas.length > 0) {
        toast(`${resultado.lancados} faturamento(s) lançado(s); ${resultado.falhas.length} falha(s)`, 'info');
      } else if (resultado.lancados > 0) {
        toast(`${resultado.lancados} faturamento(s) lançado(s)`, 'success');
      }
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao lançar faturamentos', 'error'),
  });

  const calcular = useMutation({
    mutationFn: () =>
      clientesContabilidadeService.dispararLote({ competencia, clienteContabilidadeIds: clientes.map((c) => c.id) }),
    onSuccess: (r) => setExecucaoId(r.execucaoId),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao calcular o lote', 'error'),
  });

  // Sem polling: a rota já devolve o execucaoId com o cálculo CONCLUÍDO (aguardou internamente,
  // mesmo padrão de POST /execucoes) — 1 busca única já traz o resultado final.
  const resultadosQ = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId ?? ''),
    queryFn: () => execucoesService.resultados(execucaoId!),
    enabled: !!execucaoId,
  });

  const resultados = resultadosQ.data ?? [];
  const totalOk = resultados.filter((r) => r.status === 'ok').length;
  const totalAlerta = resultados.filter((r) => r.status === 'alerta').length;
  const totalValor = resultados.reduce((acc, r) => acc + (r.totalValor ?? 0), 0);

  function fecharTudo() {
    void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucoes() });
    onClose();
  }

  if (mostrarEmissao && execucaoId) {
    return (
      <LoteEmissaoDialog
        execucaoId={execucaoId}
        onClose={() => setMostrarEmissao(false)}
        onAlgumEmitido={() => void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) })}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-cc-surface card w-full max-w-2xl shadow-2xl">
        <div className="border-b border-cc-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-cc-ink">Calcular em lote — {clientes.length} cliente{clientes.length !== 1 ? 's' : ''}</h2>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-4">
          <label className="block max-w-[10rem]">
            <span className="field-label mb-1.5">Competência</span>
            <input
              type="month"
              value={competencia}
              onChange={(e) => {
                setCompetencia(e.target.value);
                setFaturamentoLancado(false);
              }}
              className="input"
              disabled={!!execucaoId}
            />
          </label>

          {!execucaoId && precisaFaturamento && (
            <div className="space-y-3 rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4">
              <p className="text-sm text-cc-ink-2">
                {faixaFaturamento.length} cliente{faixaFaturamento.length !== 1 ? 's' : ''} no modo &ldquo;faixa de
                faturamento&rdquo; — lance o faturamento de {competencia} pra cada um (opcional: quem ficar em
                branco entra no lote como alerta, sem travar os demais).
              </p>
              <div className="max-h-52 space-y-2 overflow-y-auto">
                {faixaFaturamento.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="flex-1 truncate text-sm text-cc-ink">{c.nome}</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={faturamentos[c.id] ?? ''}
                      onChange={(e) => setFaturamentos((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="0.00"
                      className="input w-32 tabular"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => lancarFaturamentos.mutate()}
                disabled={lancarFaturamentos.isPending}
                className="btn-primary btn btn-sm"
              >
                {lancarFaturamentos.isPending ? 'Lançando…' : 'Lançar faturamentos e continuar'}
              </button>
            </div>
          )}

          {!execucaoId && !precisaFaturamento && (
            <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-4 py-3">
              <p className="text-sm text-cc-ink">
                Pronto pra calcular <strong>{clientes.length}</strong> cliente{clientes.length !== 1 ? 's' : ''} da
                competência <strong className="tabular">{competencia}</strong>.
              </p>
            </div>
          )}

          {execucaoId && (
            <div className="space-y-3">
              {resultadosQ.isLoading ? (
                <p className="text-sm text-cc-muted">Carregando resultado do lote…</p>
              ) : (
                <>
                  <dl className="grid grid-cols-3 gap-3 text-center text-sm">
                    <div className="rounded-lg border border-cc-hairline p-2">
                      <dt className="text-2xs uppercase tracking-wide text-cc-muted">Ok</dt>
                      <dd className="tabular font-semibold text-cc-success">{totalOk}</dd>
                    </div>
                    <div className="rounded-lg border border-cc-hairline p-2">
                      <dt className="text-2xs uppercase tracking-wide text-cc-muted">Alerta</dt>
                      <dd className="tabular font-semibold text-cc-warning">{totalAlerta}</dd>
                    </div>
                    <div className="rounded-lg border border-cc-hairline p-2">
                      <dt className="text-2xs uppercase tracking-wide text-cc-muted">Total</dt>
                      <dd className="tabular font-semibold text-cc-ink">{brl(totalValor)}</dd>
                    </div>
                  </dl>
                  {resultados.filter((r) => r.status === 'alerta').length > 0 && (
                    <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-cc-hairline bg-cc-surface-2 p-3 text-xs text-cc-ink-2">
                      {resultados
                        .filter((r) => r.status === 'alerta')
                        .map((r) => (
                          <li key={r.id}>
                            <strong>{r.nome}</strong>: {r.alertas[0] ?? 'alerta sem detalhe'}
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-cc-hairline px-6 py-4">
          <button onClick={fecharTudo} className="btn-ghost btn btn-sm">
            {execucaoId ? 'Fechar' : 'Cancelar'}
          </button>
          {!execucaoId && !precisaFaturamento && (
            <button
              onClick={() => calcular.mutate()}
              disabled={calcular.isPending}
              className="btn-primary btn btn-sm"
            >
              {calcular.isPending ? 'Calculando…' : `Calcular ${clientes.length} em lote`}
            </button>
          )}
          {execucaoId && totalOk > 0 && (
            <button onClick={() => setMostrarEmissao(true)} className="btn-primary btn btn-sm">
              Emitir boletos em lote
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
