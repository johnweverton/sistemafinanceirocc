'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { clientesContabilidadeService, clienteContabilidadeQueryKeys } from '@/services/clientes-contabilidade';
import { execucoesService } from '@/services/execucoes';
import { useToast } from '@/components/ui/Toast';
import { CampoCompetencia } from '@/components/ui/CampoCompetencia';
import { competenciaAtual } from '@/lib/competencia';
import { brl } from '@/lib/formato';
import { Acompanhamento } from './GerarExecucao';

/**
 * Fluxo combinado para clientes no modo `faixa_faturamento` (Story de polimento UX, 2026-07-30 —
 * feedback do dono): antes eram duas telas separadas (Faturamento em `/faturamento` e Emissão em
 * `/execucao`), forçando o operador a digitar a mesma competência duas vezes. Aqui a competência é
 * informada UMA vez só: passo 1 lança o faturamento do mês (mesma chamada de
 * `clientesContabilidadeService.lancarFaturamento` que `LancamentoFaturamento.tsx` usava), passo 2
 * — sem pedir a competência de novo — dispara a execução daquela competência e emite o boleto
 * (reaproveita `execucoesService.disparar` + o componente `Acompanhamento` de `GerarExecucao.tsx`,
 * mesmo mecanismo que clientes `fixo` já usam). O back-end não mudou: `lancarFaturamento` continua
 * só gravando o faturamento e devolvendo o preview; quem cria a execução emitível é o mesmo
 * `execucoesService.disparar` de sempre.
 */
export function FaturamentoEEmissao({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [faturamento, setFaturamento] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [recemLancado, setRecemLancado] = useState(false);
  const [execucaoId, setExecucaoId] = useState<string | null>(null);

  const { data: cliente } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.cliente(clienteId),
    queryFn: () => clientesContabilidadeService.detalhe(clienteId),
  });

  const { data: faturamentos, isLoading: carregandoFaturamentos } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.clienteFaturamentos(clienteId),
    queryFn: () => clientesContabilidadeService.listarFaturamentos(clienteId),
  });

  // Se a competência já tem faturamento lançado (sessão anterior ou recarregou a página), libera
  // direto o passo 2 — não obriga relançar só para poder emitir.
  const jaLancadoNaLista = (faturamentos ?? []).some((f) => f.competencia === competencia);
  const podeAvancarParaEmissao = jaLancadoNaLista || recemLancado;

  const lancar = useMutation({
    mutationFn: () =>
      clientesContabilidadeService.lancarFaturamento(clienteId, {
        competencia,
        faturamento: Number(faturamento),
      }),
    onSuccess: (resp) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clienteFaturamentos(clienteId) });
      setErro(null);
      setRecemLancado(true);
      if (resp.preview.alertas.length > 0) {
        toast(resp.preview.alertas[0] ?? 'Faturamento lançado com alerta na regra de preço', 'error');
      } else {
        toast(`Faturamento lançado. Valor calculado: ${brl(resp.preview.valor)}`, 'success');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao lançar faturamento';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const disparar = useMutation({
    mutationFn: () => execucoesService.disparar(competencia, [], undefined, clienteId, false),
    onSuccess: (r) => setExecucaoId(r.execucaoId),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao calcular valor', 'error'),
  });

  function onCompetenciaChange(valor: string) {
    setCompetencia(valor);
    setRecemLancado(false);
  }

  const faturamentoNum = faturamento === '' ? null : Number(faturamento);
  const podeLancar =
    /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) && faturamentoNum != null && faturamentoNum >= 0;

  if (cliente && cliente.modoCobranca !== 'faixa_faturamento') {
    return (
      <p className="text-sm text-cc-muted">
        Este cliente está no modo de cobrança &ldquo;valor fixo&rdquo;, que não usa lançamento de
        faturamento mensal.
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Emissão</h1>
          {cliente && <p className="mt-0.5 text-sm text-cc-ink-2">{cliente.nome}</p>}
        </div>
        <Link href="/clientes-contabilidade" className="btn-ghost btn btn-sm">
          Voltar
        </Link>
      </div>
      <p className="-mt-4 text-2xs text-cc-muted">
        Fluxo em 2 passos: lance o faturamento da competência e, na sequência, calcule e emita o
        boleto, sem informar a competência de novo.
      </p>

      {!execucaoId && (
        <div className="card space-y-4 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (podeLancar) lancar.mutate();
            }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-3"
          >
            <CampoCompetencia
              value={competencia}
              onChange={onCompetenciaChange}
              disabled={lancar.isPending}
            />
            <label className="block">
              <span className="field-label mb-1.5">Faturamento do mês (R$)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={faturamento}
                onChange={(e) => setFaturamento(e.target.value)}
                className="input tabular"
                placeholder="0.00"
                disabled={lancar.isPending}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={!podeLancar || lancar.isPending} className="btn-primary w-full">
                {lancar.isPending ? 'Lançando...' : 'Lançar faturamento'}
              </button>
            </div>
          </form>

          {erro && <p role="alert" className="alert-error">{erro}</p>}

          {podeAvancarParaEmissao && (
            <div className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4 space-y-3">
              <p className="text-sm text-cc-ink-2">
                Faturamento de <strong className="text-cc-ink tabular">{competencia}</strong> lançado.
                Calcule o valor da execução e emita o boleto desta mesma competência.
              </p>
              <button
                type="button"
                onClick={() => disparar.mutate()}
                disabled={disparar.isPending}
                className="btn-primary"
              >
                {disparar.isPending ? 'Calculando...' : 'Calcular e emitir boleto'}
              </button>
            </div>
          )}
        </div>
      )}

      {execucaoId && <Acompanhamento execucaoId={execucaoId} />}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-cc-ink">Faturamentos lançados</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cc-hairline text-left text-cc-muted">
                <th className="py-2.5 px-4 font-medium">Competência</th>
                <th className="py-2.5 px-4 font-medium">Faturamento informado</th>
                <th className="py-2.5 px-4 font-medium">Lançado em</th>
              </tr>
            </thead>
            <tbody>
              {carregandoFaturamentos ? (
                <tr>
                  <td colSpan={3} className="py-4 px-4 text-cc-muted">Carregando…</td>
                </tr>
              ) : !faturamentos || faturamentos.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 px-4 text-cc-muted">Nenhum faturamento lançado ainda.</td>
                </tr>
              ) : (
                faturamentos.map((f) => (
                  <tr key={f.id} className="border-b border-cc-hairline last:border-0">
                    <td className="py-2.5 px-4 font-medium text-cc-ink">{f.competencia}</td>
                    <td className="py-2.5 px-4 text-cc-ink-2 tabular">{brl(f.faturamento)}</td>
                    <td className="py-2.5 px-4 text-cc-ink-2">{new Date(f.informadoEm).toLocaleString('pt-BR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
