'use client';
// Página DRE (Story 9.3, Épico 9). Relatório: agrupado por grupo (ordem da fórmula do
// DRE, não alfabética — os 4 totais da resposta JÁ SÃO os subtotais por grupo, sem
// re-soma no cliente) + resultado líquido. Lançamentos manuais: lista + diálogo de
// criação com campos condicionais por tipo (avulso/recorrente).
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { ContaEmissora, GrupoPlanoContas, PlanoContas } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL, CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';
import { dreService, dreQueryKeys, type CriarLancamentoInput, type RelatorioDre } from '@/services/dre';
import { planoContasService, planoContasQueryKeys } from '@/services/plano-contas';
import { ApiClientError } from '@/lib/api-client';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Primeiro dia do mês corrente e hoje (YYYY-MM-DD, fuso local) — mesmo default do /extrato. */
function periodoMesCorrente(): { inicio: string; fim: string } {
  const agora = new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { inicio: ymd(new Date(agora.getFullYear(), agora.getMonth(), 1)), fim: ymd(agora) };
}

const GRUPOS_ORDENADOS: { grupo: GrupoPlanoContas; label: string }[] = [
  { grupo: 'receita', label: 'Receitas' },
  { grupo: 'deducao_receita', label: 'Deduções da Receita' },
  { grupo: 'despesa_operacional', label: 'Despesas Operacionais' },
  { grupo: 'despesa_financeira', label: 'Despesas Financeiras' },
];

function totalDoGrupo(r: RelatorioDre, grupo: GrupoPlanoContas): number {
  switch (grupo) {
    case 'receita':
      return r.totalReceitas;
    case 'deducao_receita':
      return r.totalDeducoes;
    case 'despesa_operacional':
      return r.totalDespesasOperacionais;
    case 'despesa_financeira':
      return r.totalDespesasFinanceiras;
  }
}

/** Diálogo de criação de lançamento manual — campos condicionais por tipo (avulso/recorrente). */
function NovoLancamentoDialog({
  categorias,
  contaEmissoraPadrao,
  criando,
  onConfirm,
  onCancel,
}: {
  categorias: PlanoContas[];
  /** Empresa pré-selecionada = filtro ativo na tela; 'mc' quando "Consolidado". */
  contaEmissoraPadrao: ContaEmissora;
  criando: boolean;
  onConfirm: (input: CriarLancamentoInput) => void;
  onCancel: () => void;
}) {
  const [tipo, setTipo] = useState<'avulso' | 'recorrente'>('avulso');
  const [contaEmissora, setContaEmissora] = useState<ContaEmissora>(contaEmissoraPadrao);
  const [categoriaId, setCategoriaId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState('');
  const [diaDoMes, setDiaDoMes] = useState('5');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  const valorNum = Number(valor);
  const valido =
    !!categoriaId &&
    descricao.trim().length > 0 &&
    valorNum > 0 &&
    (tipo === 'avulso' ? !!data : !!diaDoMes && Number(diaDoMes) >= 1 && Number(diaDoMes) <= 28 && !!dataInicio);

  function submit() {
    if (!valido) return;
    const base = { contaEmissora, categoriaId, descricao: descricao.trim(), valor: valorNum };
    onConfirm(
      tipo === 'avulso'
        ? { ...base, tipoLancamento: 'avulso', data }
        : {
            ...base,
            tipoLancamento: 'recorrente',
            diaDoMes: Number(diaDoMes),
            dataInicio,
            dataFim: dataFim || null,
          },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Novo lançamento manual"
        className="bg-cc-surface card w-full max-w-lg shadow-2xl"
      >
        <div className="border-b border-cc-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-cc-ink">Novo lançamento manual</h2>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div className="flex gap-2" role="group" aria-label="Tipo de lançamento">
            <button
              type="button"
              onClick={() => setTipo('avulso')}
              className={`btn btn-sm flex-1 ${tipo === 'avulso' ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={tipo === 'avulso'}
            >
              Avulso
            </button>
            <button
              type="button"
              onClick={() => setTipo('recorrente')}
              className={`btn btn-sm flex-1 ${tipo === 'recorrente' ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={tipo === 'recorrente'}
            >
              Recorrente
            </button>
          </div>
          <select
            value={contaEmissora}
            onChange={(e) => setContaEmissora(e.target.value as ContaEmissora)}
            className="input w-full"
            aria-label="Empresa"
          >
            {CONTAS_EMISSORAS_VALIDAS.map((c) => (
              <option key={c} value={c}>{CONTA_EMISSORA_LABEL[c]}</option>
            ))}
          </select>
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="input w-full"
            aria-label="Categoria"
          >
            <option value="">Selecione a categoria…</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição"
            className="input w-full"
            aria-label="Descrição"
          />
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            type="number"
            step="0.01"
            placeholder="Valor"
            className="input w-full"
            aria-label="Valor"
          />
          {tipo === 'avulso' ? (
            <input
              value={data}
              onChange={(e) => setData(e.target.value)}
              type="date"
              className="input w-full"
              aria-label="Data"
            />
          ) : (
            <>
              <input
                value={diaDoMes}
                onChange={(e) => setDiaDoMes(e.target.value)}
                type="number"
                min={1}
                max={28}
                className="input w-full"
                aria-label="Dia do mês"
              />
              <input
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                type="date"
                className="input w-full"
                aria-label="Início da recorrência"
              />
              <input
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                type="date"
                className="input w-full"
                aria-label="Fim da recorrência (opcional)"
              />
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-cc-hairline px-6 py-4">
          <button onClick={onCancel} disabled={criando} className="btn-ghost btn btn-sm">
            Cancelar
          </button>
          <button onClick={submit} disabled={criando || !valido} className="btn-primary btn btn-sm">
            {criando ? 'Salvando…' : 'Criar lançamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DreManager() {
  const padrao = periodoMesCorrente();
  const [inicio, setInicio] = useState(padrao.inicio);
  const [fim, setFim] = useState(padrao.fim);
  const [conta, setConta] = useState<ContaEmissora | ''>('');
  const [novoLancamento, setNovoLancamento] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const filtro = { inicio, fim, conta: conta || undefined };

  const relatorioQ = useQuery({
    queryKey: dreQueryKeys.relatorio(filtro),
    queryFn: () => dreService.relatorio(filtro),
  });
  const lancamentosQ = useQuery({
    queryKey: dreQueryKeys.lancamentos(conta || undefined),
    queryFn: () => dreService.listarLancamentos(conta || undefined),
  });
  // Lista COMPLETA (ativas + inativas) — uma categoria pode ser desativada (soft-disable)
  // enquanto ainda referenciada por lançamentos antigos; usar só ativas faria o nome
  // sumir (virar "—") para lançamentos históricos de categorias desativadas depois.
  const categoriasQ = useQuery({
    queryKey: planoContasQueryKeys.categorias(),
    queryFn: () => planoContasService.listarCategorias(),
  });
  // Só as ativas entram como opção selecionável no diálogo de novo lançamento.
  const categoriasAtivas = useMemo(
    () => (categoriasQ.data ?? []).filter((c) => c.ativo),
    [categoriasQ.data],
  );

  const categoriaPorId = useMemo(
    () => new Map((categoriasQ.data ?? []).map((c) => [c.id, c])),
    [categoriasQ.data],
  );

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['dre'] });
  }
  function erroToast(e: unknown, fallback: string) {
    toast(e instanceof ApiClientError ? e.message : fallback, 'error');
  }

  const criarLancamento = useMutation({
    mutationFn: (input: CriarLancamentoInput) => dreService.criarLancamento(input),
    onSuccess: () => {
      toast('Lançamento criado.', 'success');
      setNovoLancamento(false);
      invalidar();
    },
    onError: (e) => erroToast(e, 'Erro ao criar lançamento'),
  });

  const excluirLancamento = useMutation({
    mutationFn: (id: string) => dreService.excluirLancamento(id),
    onSuccess: () => {
      toast('Lançamento excluído.', 'success');
      invalidar();
    },
    onError: (e) => erroToast(e, 'Erro ao excluir lançamento'),
  });

  const dados = relatorioQ.data;
  const lancamentos = lancamentosQ.data ?? [];
  const porGrupo = useMemo(() => {
    if (!dados) return [];
    return GRUPOS_ORDENADOS.map((g) => ({
      ...g,
      total: totalDoGrupo(dados, g.grupo),
      categorias: dados.porCategoria.filter((c) => c.grupo === g.grupo),
    }));
  }, [dados]);

  const semDados = !relatorioQ.isLoading && dados && dados.porCategoria.length === 0 && lancamentos.length === 0;

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">DRE</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            className="input w-40"
            aria-label="Início do período"
          />
          <input
            type="date"
            value={fim}
            onChange={(e) => setFim(e.target.value)}
            className="input w-40"
            aria-label="Fim do período"
          />
          <select
            value={conta}
            onChange={(e) => setConta(e.target.value as ContaEmissora | '')}
            className="input w-44"
            aria-label="Empresa"
          >
            <option value="">Consolidado</option>
            {CONTAS_EMISSORAS_VALIDAS.map((c) => (
              <option key={c} value={c}>{CONTA_EMISSORA_LABEL[c]}</option>
            ))}
          </select>
          <Link href="/dre/cadastro" className="btn-ghost btn btn-sm">
            Plano de contas
          </Link>
        </div>
      </div>

      {relatorioQ.isLoading ? (
        <Skeleton className="h-64" />
      ) : !dados ? (
        <EmptyState
          title="Não foi possível carregar o relatório"
          description="Tente novamente em instantes."
        />
      ) : semDados ? (
        <EmptyState
          title="Sem dados no período"
          description="Sincronize o extrato ou lance uma despesa manual para ver o DRE deste período."
        />
      ) : (
        <>
          <div className="card space-y-4 p-5">
            {porGrupo.map((g) => (
              <div key={g.grupo}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-cc-ink">{g.label}</h2>
                  <span className="tabular font-semibold text-cc-ink">{brl(g.total)}</span>
                </div>
                {g.categorias.length > 0 && (
                  <ul className="mt-1 space-y-1 pl-4">
                    {g.categorias.map((c) => (
                      <li key={c.categoriaId} className="flex items-center justify-between text-sm text-cc-ink-2">
                        <span>{c.nome}</span>
                        <span className="tabular">{brl(c.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-cc-hairline pt-3">
              <h2 className="text-base font-bold text-cc-ink">Resultado líquido</h2>
              <span
                className={`tabular text-lg font-bold ${dados.resultadoLiquido >= 0 ? 'text-cc-success' : 'text-cc-danger'}`}
              >
                {brl(dados.resultadoLiquido)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-cc-ink">Lançamentos manuais</h2>
              <button onClick={() => setNovoLancamento(true)} className="btn-primary btn btn-sm">
                Novo lançamento
              </button>
            </div>
            {lancamentos.length === 0 ? (
              <p className="text-sm text-cc-muted">Nenhum lançamento manual cadastrado.</p>
            ) : (
              <div className="card overflow-x-auto">
                <table className="data-table">
                  <thead className="border-b border-cc-hairline bg-cc-surface-2">
                    <tr>
                      <th>Descrição</th>
                      <th>Categoria</th>
                      <th>Empresa</th>
                      <th>Tipo</th>
                      <th className="text-right">Valor</th>
                      <th className="text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lancamentos.map((l) => (
                      <tr key={l.id}>
                        <td>{l.descricao}</td>
                        <td>{categoriaPorId.get(l.categoriaId)?.nome ?? '—'}</td>
                        <td>{CONTA_EMISSORA_LABEL[l.contaEmissora]}</td>
                        <td>
                          {l.tipoLancamento === 'avulso' ? (
                            <>Avulso · {l.data}</>
                          ) : (
                            <>Recorrente · dia {l.diaDoMes}{l.dataFim ? <> até {l.dataFim}</> : null}</>
                          )}
                        </td>
                        <td className="text-right tabular">{brl(l.valor)}</td>
                        <td className="text-right">
                          <button
                            onClick={() => excluirLancamento.mutate(l.id)}
                            disabled={excluirLancamento.isPending}
                            className="btn-ghost btn btn-sm text-cc-danger"
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {novoLancamento && (
        <NovoLancamentoDialog
          categorias={categoriasAtivas}
          contaEmissoraPadrao={conta || 'mc'}
          criando={criarLancamento.isPending}
          onConfirm={(input) => criarLancamento.mutate(input)}
          onCancel={() => setNovoLancamento(false)}
        />
      )}
    </section>
  );
}
