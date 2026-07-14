'use client';
// Página Extrato/Conciliação (Story 8.3, Épico 8). Padrões reusados: filtros/badges/tabela
// de Recebíveis, EmptyState, Toast, diálogo próprio (7.3). A fila de sugestões fica em
// destaque no topo (transação × boleto candidato lado a lado); tudo reversível.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContaEmissora,
  ExtratoTransacaoComBoleto,
  PlanoContas,
  Recebivel,
  StatusCategorizacao,
  StatusConciliacao,
} from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL, CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';
import { extratoService, extratoQueryKeys, type FiltroExtratoUi } from '@/services/extrato';
import { planoContasService, planoContasQueryKeys } from '@/services/plano-contas';
import { ApiClientError } from '@/lib/api-client';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Data ISO → dd/mm/aa hh:mm locais (mesmo formato dos Recebíveis). */
function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Primeiro dia do mês corrente e hoje (YYYY-MM-DD, fuso local) — período default (risco: lista longa). */
function periodoMesCorrente(): { inicio: string; fim: string } {
  const agora = new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { inicio: ymd(new Date(agora.getFullYear(), agora.getMonth(), 1)), fim: ymd(agora) };
}

function StatusConciliacaoBadge({ status }: { status: StatusConciliacao }) {
  if (status === 'conciliado_auto') return <span className="badge-green">Conciliado (auto)</span>;
  if (status === 'conciliado_manual') return <span className="badge-green">Conciliado</span>;
  if (status === 'sugerido') return <span className="badge-amber">Sugestão</span>;
  if (status === 'ignorado') return <span className="badge-slate">Ignorado</span>;
  return <span className="badge-slate">Sem match</span>;
}

/** Badge do eixo de categorização do DRE (Épico 9) — independente da conciliação. */
function CategorizacaoBadge({ status, nome }: { status: StatusCategorizacao; nome: string | null }) {
  if (status === 'confirmada') return <span className="badge-green">{nome}</span>;
  if (status === 'sugerida') return <span className="badge-amber">Sugestão: {nome}</span>;
  return <span className="badge-slate">Sem categoria</span>;
}

const STATUS_OPCOES: { valor: StatusConciliacao | ''; label: string }[] = [
  { valor: '', label: 'Todos os status' },
  { valor: 'sem_match', label: 'Sem match' },
  { valor: 'sugerido', label: 'Sugestão' },
  { valor: 'conciliado_auto', label: 'Conciliado (auto)' },
  { valor: 'conciliado_manual', label: 'Conciliado (manual)' },
  { valor: 'ignorado', label: 'Ignorado' },
];

// 'FEE' é filtro de UI: a API filtra tipo=DEBIT e o recorte de tarifa é client-side.
type TipoUi = '' | 'CREDIT' | 'DEBIT' | 'FEE';
const TIPO_OPCOES: { valor: TipoUi; label: string }[] = [
  { valor: '', label: 'Créditos e débitos' },
  { valor: 'CREDIT', label: 'Créditos' },
  { valor: 'DEBIT', label: 'Débitos' },
  { valor: 'FEE', label: 'Tarifas' },
];

const POR_PAGINA = 50;

/**
 * Diálogo de vínculo manual: busca boleto PAGO livre da MESMA conta. Não reusa ConfirmDialog
 * porque exige seleção em lista (mesma razão do CancelarBoletoDialog da 6.1).
 */
function VincularBoletoDialog({
  transacao,
  conta,
  vinculando,
  onConfirm,
  onCancel,
}: {
  transacao: ExtratoTransacaoComBoleto;
  conta: ContaEmissora;
  vinculando: boolean;
  onConfirm: (boletoId: string) => void;
  onCancel: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: extratoQueryKeys.boletosConciliaveis(conta),
    queryFn: () => extratoService.boletosConciliaveis(conta),
  });

  const boletos = useMemo(() => {
    const lista = data ?? [];
    const q = busca.trim().toLowerCase();
    return q ? lista.filter((b) => b.nome.toLowerCase().includes(q)) : lista;
  }, [data, busca]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vincular boleto pago"
        className="bg-cc-surface card w-full max-w-lg shadow-2xl"
      >
        <div className="border-b border-cc-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-cc-ink">Vincular boleto pago</h2>
          <p className="mt-1 text-sm text-cc-ink-2">
            Crédito de <strong>{brl(transacao.valor)}</strong> em {dataHora(transacao.dataTransacao)}
            {transacao.contraparteNome ? <> — {transacao.contraparteNome}</> : null}. Selecione o
            boleto pago de {CONTA_EMISSORA_LABEL[conta]} correspondente.
          </p>
        </div>
        <div className="space-y-3 px-6 py-4">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por médico…"
            className="input w-full"
            aria-label="Buscar boleto por médico"
          />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-cc-hairline">
            {isLoading ? (
              <p className="p-4 text-sm text-cc-muted">Carregando boletos pagos…</p>
            ) : boletos.length === 0 ? (
              <p className="p-4 text-sm text-cc-muted">
                Nenhum boleto pago livre nesta conta. Boletos já conciliados não aparecem aqui.
              </p>
            ) : (
              <ul>
                {boletos.map((b) => (
                  <li key={b.boletoId}>
                    <button
                      type="button"
                      onClick={() => setSelecionado(b.boletoId)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-cc-surface-2 ${
                        selecionado === b.boletoId ? 'bg-cc-surface-2 font-semibold' : ''
                      }`}
                      aria-pressed={selecionado === b.boletoId}
                    >
                      <span className="min-w-0 truncate">
                        {b.nome} <span className="text-cc-muted">· {b.competencia}</span>
                      </span>
                      <span className="tabular shrink-0">
                        {brl(b.valorPago ?? b.valor)}
                        {b.pagoEm ? (
                          <span className="ml-2 font-mono text-2xs text-cc-muted">{dataHora(b.pagoEm)}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-cc-hairline px-6 py-4">
          <button onClick={onCancel} disabled={vinculando} className="btn-ghost btn btn-sm">
            Voltar
          </button>
          <button
            onClick={() => selecionado && onConfirm(selecionado)}
            disabled={vinculando || !selecionado}
            className="btn-primary btn btn-sm"
          >
            {vinculando ? 'Vinculando…' : 'Conciliar com este boleto'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Diálogo de categorização manual (Story 9.3): lista o plano de contas ATIVO agrupado
 * na ordem da fórmula do DRE, para escolher/corrigir a categoria de uma transação.
 */
function CategorizarDialog({
  transacao,
  categorizando,
  onConfirm,
  onCancel,
}: {
  transacao: ExtratoTransacaoComBoleto;
  categorizando: boolean;
  onConfirm: (categoriaId: string) => void;
  onCancel: () => void;
}) {
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: planoContasQueryKeys.categorias(true),
    queryFn: () => planoContasService.listarCategorias(true),
  });

  const porGrupo = useMemo(() => {
    const grupos: { grupo: string; label: string; categorias: PlanoContas[] }[] = [
      { grupo: 'receita', label: 'Receitas', categorias: [] },
      { grupo: 'deducao_receita', label: 'Deduções da Receita', categorias: [] },
      { grupo: 'despesa_operacional', label: 'Despesas Operacionais', categorias: [] },
      { grupo: 'despesa_financeira', label: 'Despesas Financeiras', categorias: [] },
    ];
    for (const c of data ?? []) {
      grupos.find((g) => g.grupo === c.grupo)?.categorias.push(c);
    }
    return grupos.filter((g) => g.categorias.length > 0);
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Categorizar transação"
        className="bg-cc-surface card w-full max-w-lg shadow-2xl"
      >
        <div className="border-b border-cc-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-cc-ink">Categorizar transação</h2>
          <p className="mt-1 text-sm text-cc-ink-2">
            <strong>{brl(transacao.valor)}</strong> em {dataHora(transacao.dataTransacao)}
            {transacao.contraparteNome ? <> — {transacao.contraparteNome}</> : null}. Escolha a
            categoria do plano de contas.
          </p>
        </div>
        <div className="max-h-80 space-y-4 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <p className="text-sm text-cc-muted">Carregando plano de contas…</p>
          ) : porGrupo.length === 0 ? (
            <p className="text-sm text-cc-muted">
              Nenhuma categoria ativa cadastrada — vá em Plano de contas para criar uma.
            </p>
          ) : (
            porGrupo.map((g) => (
              <div key={g.grupo}>
                <p className="mb-1 font-mono text-2xs uppercase tracking-wider text-cc-muted">
                  {g.label}
                </p>
                <ul className="overflow-hidden rounded-lg border border-cc-hairline">
                  {g.categorias.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelecionado(c.id)}
                        className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors hover:bg-cc-surface-2 ${
                          selecionado === c.id ? 'bg-cc-surface-2 font-semibold' : ''
                        }`}
                        aria-pressed={selecionado === c.id}
                      >
                        {c.nome}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-cc-hairline px-6 py-4">
          <button onClick={onCancel} disabled={categorizando} className="btn-ghost btn btn-sm">
            Voltar
          </button>
          <button
            onClick={() => selecionado && onConfirm(selecionado)}
            disabled={categorizando || !selecionado}
            className="btn-primary btn btn-sm"
          >
            {categorizando ? 'Salvando…' : 'Categorizar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Card da fila de sugestões: transação × boleto candidato lado a lado. */
function SugestaoCard({
  t,
  pendente,
  onConfirmar,
  onVincularOutro,
  onIgnorar,
}: {
  t: ExtratoTransacaoComBoleto;
  pendente: boolean;
  onConfirmar: () => void;
  onVincularOutro: () => void;
  onIgnorar: () => void;
}) {
  const b = t.boletoVinculado;
  return (
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-cc-ink">
          {brl(t.valor)} <span className="text-cc-muted">· {dataHora(t.dataTransacao)}</span>
        </p>
        <p className="truncate text-xs text-cc-ink-2">
          {t.contraparteNome ?? 'Contraparte não informada'}
          {t.contraparteDocumento ? <span className="font-mono"> · {t.contraparteDocumento}</span> : null}
        </p>
      </div>
      <div className="text-cc-muted" aria-hidden>
        →
      </div>
      <div className="min-w-0 flex-1">
        {b ? (
          <>
            <p className="truncate text-sm font-medium text-cc-ink">{b.nome}</p>
            <p className="text-xs text-cc-ink-2">
              {b.competencia} · pago {b.pagoEm ? dataHora(b.pagoEm) : '—'} · {brl(b.valorPago ?? b.valor)}
            </p>
          </>
        ) : (
          <p className="text-sm text-cc-ink-2">
            Mais de um boleto candidato — vincule manualmente o correto.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {b && (
          <button onClick={onConfirmar} disabled={pendente} className="btn-primary btn btn-sm">
            Confirmar
          </button>
        )}
        <button onClick={onVincularOutro} disabled={pendente} className="btn-ghost btn btn-sm">
          {b ? 'Vincular outro' : 'Vincular boleto'}
        </button>
        <button onClick={onIgnorar} disabled={pendente} className="btn-ghost btn btn-sm text-cc-danger">
          Ignorar
        </button>
      </div>
    </div>
  );
}

export function ExtratoManager() {
  const padrao = periodoMesCorrente();
  const [conta, setConta] = useState<ContaEmissora>('mc'); // obrigatório, default MC
  const [inicio, setInicio] = useState(padrao.inicio);
  const [fim, setFim] = useState(padrao.fim);
  const [status, setStatus] = useState<StatusConciliacao | ''>('');
  const [tipoUi, setTipoUi] = useState<TipoUi>('');
  const [vinculando, setVinculando] = useState<ExtratoTransacaoComBoleto | null>(null);
  const [categorizando, setCategorizando] = useState<ExtratoTransacaoComBoleto | null>(null);
  const [visiveis, setVisiveis] = useState(POR_PAGINA);
  const qc = useQueryClient();
  const { toast } = useToast();

  const filtros: FiltroExtratoUi = {
    conta,
    inicio: inicio || undefined,
    fim: fim || undefined,
    status: status || undefined,
    tipo: tipoUi === 'FEE' ? 'DEBIT' : tipoUi || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: extratoQueryKeys.extrato(filtros),
    queryFn: () => extratoService.listar(filtros),
  });

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['extrato'] });
  }

  function erroToast(e: unknown, fallback: string) {
    toast(e instanceof ApiClientError ? e.message : fallback, 'error');
  }

  const sincronizar = useMutation({
    mutationFn: () => extratoService.sincronizar(conta),
    onSuccess: (r) => {
      toast(
        `Extrato de ${CONTA_EMISSORA_LABEL[conta]} sincronizado (${r.periodo.inicio} a ${r.periodo.fim}): ` +
          `${r.transacoes.novas} novas, ${r.transacoes.atualizadas} atualizadas · ` +
          `${r.conciliacao.autoConciliadas} conciliadas automaticamente, ${r.conciliacao.sugeridas} sugestões`,
        'success',
      );
      invalidar();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'CONTA_NAO_CONFIGURADA') {
        toast(
          `A conta ${CONTA_EMISSORA_LABEL[conta]} ainda não tem credenciais configuradas — o extrato dela fica disponível quando a integração for ativada.`,
          'info',
        );
        return;
      }
      erroToast(e, 'Erro ao sincronizar o extrato');
    },
  });

  const conciliar = useMutation({
    mutationFn: ({ transacaoId, boletoId }: { transacaoId: string; boletoId: string }) =>
      extratoService.conciliar(transacaoId, boletoId),
    onSuccess: () => {
      toast('Transação conciliada com o boleto.', 'success');
      setVinculando(null);
      invalidar();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'BOLETO_JA_CONCILIADO') {
        toast('Este boleto acabou de ser conciliado com outra transação — escolha outro.', 'info');
        invalidar();
        return;
      }
      erroToast(e, 'Erro ao conciliar a transação');
    },
  });

  const categorizar = useMutation({
    mutationFn: ({ transacaoId, categoriaId }: { transacaoId: string; categoriaId?: string }) =>
      extratoService.categorizar(transacaoId, categoriaId),
    onSuccess: () => {
      toast('Transação categorizada.', 'success');
      setCategorizando(null);
      invalidar();
    },
    onError: (e) => erroToast(e, 'Erro ao categorizar a transação'),
  });

  const ignorar = useMutation({
    mutationFn: (transacaoId: string) => extratoService.ignorar(transacaoId),
    onSuccess: () => {
      toast('Transação marcada como ignorada (reversível em Desfazer).', 'success');
      invalidar();
    },
    onError: (e) => erroToast(e, 'Erro ao ignorar a transação'),
  });

  const desfazer = useMutation({
    mutationFn: (transacaoId: string) => extratoService.desfazer(transacaoId),
    onSuccess: () => {
      // OBS-821 (gate 8.2): sem reclassificar, o próximo sync pode reconciliar o mesmo par.
      toast(
        'Vínculo desfeito. Vincule o boleto correto ou ignore a transação — senão a próxima sincronização pode sugerir o mesmo par.',
        'info',
      );
      invalidar();
    },
    onError: (e) => erroToast(e, 'Erro ao desfazer'),
  });

  const pendente =
    conciliar.isPending ||
    ignorar.isPending ||
    desfazer.isPending ||
    sincronizar.isPending ||
    categorizar.isPending;

  const transacoes = useMemo(() => {
    const lista = data?.transacoes ?? [];
    return tipoUi === 'FEE' ? lista.filter((t) => t.transactionType === 'FEE') : lista;
  }, [data, tipoUi]);

  const sugestoes = transacoes.filter((t) => t.statusConciliacao === 'sugerido');
  const pagina = transacoes.slice(0, visiveis);
  const totais = data?.totais;

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Extrato bancário</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={conta}
            onChange={(e) => {
              setConta(e.target.value as ContaEmissora);
              setVisiveis(POR_PAGINA);
            }}
            className="input w-44"
            aria-label="Empresa"
          >
            {CONTAS_EMISSORAS_VALIDAS.map((c) => (
              <option key={c} value={c}>{CONTA_EMISSORA_LABEL[c]}</option>
            ))}
          </select>
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
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusConciliacao | '')}
            className="input w-44"
            aria-label="Status de conciliação"
          >
            {STATUS_OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>
          <select
            value={tipoUi}
            onChange={(e) => setTipoUi(e.target.value as TipoUi)}
            className="input w-44"
            aria-label="Tipo de transação"
          >
            {TIPO_OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => sincronizar.mutate()}
            disabled={sincronizar.isPending}
            className="btn-primary btn btn-sm"
          >
            {sincronizar.isPending ? 'Sincronizando…' : `Sincronizar (${CONTA_EMISSORA_LABEL[conta]})`}
          </button>
        </div>
      </div>

      {/* Totais do período (tarifas ⊂ saídas) */}
      {totais && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-xs text-cc-muted">Recebido no período</p>
            <p className="text-lg font-bold text-cc-success">{brl(totais.creditos)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-cc-muted">Saídas no período</p>
            <p className="text-lg font-bold text-cc-danger">{brl(totais.debitos)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-cc-muted">Tarifas bancárias</p>
            <p className="text-lg font-bold text-cc-ink">{brl(totais.tarifas)}</p>
          </div>
        </div>
      )}

      {/* Fila de sugestões em destaque */}
      {sugestoes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-cc-ink">
            Sugestões de conciliação <span className="font-normal text-cc-muted">· revise e confirme</span>
          </h2>
          {sugestoes.map((t) => (
            <SugestaoCard
              key={t.id}
              t={t}
              pendente={pendente}
              onConfirmar={() =>
                t.boletoVinculado &&
                conciliar.mutate({ transacaoId: t.id, boletoId: t.boletoVinculado.boletoId })
              }
              onVincularOutro={() => setVinculando(t)}
              onIgnorar={() => ignorar.mutate(t.id)}
            />
          ))}
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} cols={8} />
      ) : transacoes.length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h18M3 12h18M3 17h12" />
            </svg>
          }
          title="Nenhuma transação no período"
          description={`Sincronize o extrato de ${CONTA_EMISSORA_LABEL[conta]} para trazer as transações do banco, ou ajuste o período e os filtros.`}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Contraparte</th>
                <th className="text-right">Valor</th>
                <th>Conciliação</th>
                <th>Boleto vinculado</th>
                <th>Categoria</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pagina.map((t) => (
                <tr key={t.id}>
                  <td className="font-mono tabular text-cc-ink-2">{dataHora(t.dataTransacao)}</td>
                  <td className="max-w-56 truncate" title={t.descricao ?? undefined}>
                    {t.descricao ?? t.transactionType ?? '—'}
                  </td>
                  <td className="max-w-48">
                    <span className="block truncate">{t.contraparteNome ?? '—'}</span>
                    {t.contraparteDocumento && (
                      <span className="font-mono text-2xs text-cc-muted">{t.contraparteDocumento}</span>
                    )}
                  </td>
                  <td
                    className={`text-right tabular font-medium ${
                      t.tipo === 'CREDIT' ? 'text-cc-success' : 'text-cc-danger'
                    }`}
                  >
                    {t.tipo === 'CREDIT' ? '+' : '−'} {brl(t.valor)}
                  </td>
                  <td><StatusConciliacaoBadge status={t.statusConciliacao} /></td>
                  <td className="max-w-48">
                    {t.boletoVinculado ? (
                      <span className="block truncate text-sm" title={`Competência ${t.boletoVinculado.competencia}`}>
                        {t.boletoVinculado.nome}
                        <span className="text-cc-muted"> · {t.boletoVinculado.competencia}</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <CategorizacaoBadge status={t.statusCategorizacao} nome={t.categoria?.nome ?? null} />
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {t.tipo === 'CREDIT' &&
                        (t.statusConciliacao === 'sem_match' || t.statusConciliacao === 'sugerido') && (
                          <button
                            onClick={() => setVinculando(t)}
                            className="btn-ghost btn btn-sm"
                            disabled={pendente}
                          >
                            Vincular
                          </button>
                        )}
                      {(t.statusConciliacao === 'sem_match' || t.statusConciliacao === 'sugerido') && (
                        <button
                          onClick={() => ignorar.mutate(t.id)}
                          className="btn-ghost btn btn-sm"
                          disabled={pendente}
                        >
                          Ignorar
                        </button>
                      )}
                      {t.statusConciliacao !== 'sem_match' && t.statusConciliacao !== 'sugerido' && (
                        <button
                          onClick={() => desfazer.mutate(t.id)}
                          className="btn-ghost btn btn-sm text-cc-danger"
                          disabled={pendente}
                        >
                          Desfazer
                        </button>
                      )}
                      {t.statusCategorizacao === 'sugerida' && (
                        <button
                          onClick={() => categorizar.mutate({ transacaoId: t.id, categoriaId: t.categoriaId! })}
                          className="btn-ghost btn btn-sm"
                          disabled={pendente}
                        >
                          Confirmar
                        </button>
                      )}
                      {t.statusCategorizacao !== 'confirmada' && (
                        <button
                          onClick={() => setCategorizando(t)}
                          className="btn-ghost btn btn-sm"
                          disabled={pendente}
                        >
                          Categorizar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {transacoes.length > visiveis && (
            <div className="border-t border-cc-hairline p-3 text-center">
              <button onClick={() => setVisiveis((v) => v + POR_PAGINA)} className="btn-ghost btn btn-sm">
                Mostrar mais ({transacoes.length - visiveis} restantes)
              </button>
            </div>
          )}
        </div>
      )}

      {vinculando && (
        <VincularBoletoDialog
          transacao={vinculando}
          conta={conta}
          vinculando={conciliar.isPending}
          onConfirm={(boletoId) => conciliar.mutate({ transacaoId: vinculando.id, boletoId })}
          onCancel={() => setVinculando(null)}
        />
      )}

      {categorizando && (
        <CategorizarDialog
          transacao={categorizando}
          categorizando={categorizar.isPending}
          onConfirm={(categoriaId) => categorizar.mutate({ transacaoId: categorizando.id, categoriaId })}
          onCancel={() => setCategorizando(null)}
        />
      )}
    </section>
  );
}
