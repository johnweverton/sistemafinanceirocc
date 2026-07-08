'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Medico } from '@cobranca/shared';
import { tipoDoMedico, cobrancaCompleta } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import {
  medicosService,
  queryKeys,
  type NovoMedicoPayload,
  type AtualizarMedicoPayload,
  type ImportarResultado,
  type SyncRelatorio,
  type ExclusaoLoteResultado,
} from '@/services/medicos';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MedicoForm } from './MedicoForm';

import { SyncModal } from './SyncModal';

type Modo = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'editar'; medico: Medico };
type FiltroStatus = 'todos' | 'aguardando' | 'ativos' | 'inativos' | 'cobranca_incompleta';
type Confirmacao = { tipo: 'unico'; medico: Medico } | { tipo: 'lote'; ids: string[] };

const POR_PAGINA = 25;

function pendenciasDoMedico(m: Medico): string[] {
  const p: string[] = [];
  if (!m.cpf) p.push('CPF ausente');
  if (!m.especialidade) p.push('Especialidade ausente');
  if (!cobrancaCompleta(m)) p.push('Dados de cobrança incompletos');
  if (!m.externalId) p.push('Não vinculado à origem');
  return p;
}

/** Estado único por médico — substitui os 3 indicadores de "pendente" que existiam antes
 * (badge no nome + coluna Tipo + coluna Status), todos derivados do mesmo dado. */
type Status = 'aguardando' | 'inativo' | 'cobranca_incompleta' | 'ativo';

function calcularStatus(m: Medico): Status {
  if (m.necessitaConfiguracao) return 'aguardando';
  if (!m.ativo) return 'inativo';
  if (!cobrancaCompleta(m)) return 'cobranca_incompleta';
  return 'ativo';
}

const STATUS_INFO: Record<Status, { label: string; badge: string }> = {
  aguardando: { label: 'Aguarda configuração', badge: 'badge-amber' },
  inativo: { label: 'Inativo', badge: 'badge-slate' },
  cobranca_incompleta: { label: 'Cobrança incompleta', badge: 'badge-amber' },
  ativo: { label: 'Ativo', badge: 'badge-green' },
};

const FILTRO_OPCOES: { valor: FiltroStatus; label: string }[] = [
  { valor: 'todos', label: 'Todos' },
  { valor: 'aguardando', label: 'Aguardando configuração' },
  { valor: 'ativos', label: 'Ativos' },
  { valor: 'inativos', label: 'Inativos' },
  { valor: 'cobranca_incompleta', label: 'Cobrança incompleta' },
];

function normalizarBusca(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function MedicosManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [erro, setErro] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportarResultado | null>(null);
  const [syncRelatorio, setSyncRelatorio] = useState<SyncRelatorio | null>(null);
  const [excluirLoteResultado, setExcluirLoteResultado] = useState<ExclusaoLoteResultado | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [pagina, setPagina] = useState(1);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importar = useMutation({
    mutationFn: (arquivo: File) => medicosService.importar(arquivo),
    onSuccess: (resultado) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setImportResult(resultado);
      setErro(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (resultado.erros.length === 0) {
        toast(`${resultado.criados} médico(s) importado(s) com sucesso`, 'success');
      } else {
        toast(`Importação com ${resultado.erros.length} erro(s) — veja os detalhes`, 'info');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro na importacao';
      setErro(msg);
      toast(msg, 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const sincronizar = useMutation({
    mutationFn: () => medicosService.sincronizar(),
    onSuccess: (relatorio) => {
      setSyncRelatorio(relatorio);
      setErro(null);
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao sincronizar origem';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const { data: medicos, isLoading, isError } = useQuery({
    queryKey: queryKeys.medicos(),
    queryFn: () => medicosService.listar(),
    retry: (count, err) => {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) return false;
      return count < 2;
    },
  });

  const criar = useMutation({
    mutationFn: (p: NovoMedicoPayload) => medicosService.criar(p),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Médico ${m.nome} cadastrado`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const atualizar = useMutation({
    mutationFn: ({ id, p }: { id: string; p: AtualizarMedicoPayload }) =>
      medicosService.atualizar(id, p),
    onSuccess: (m, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      void qc.invalidateQueries({ queryKey: queryKeys.medicoHistorico(vars.id) });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Alterações de ${m.nome} salvas`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const excluirUm = useMutation({
    mutationFn: (id: string) => medicosService.excluir(id),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setSelecionados((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setConfirmacao(null);
      toast('Médico excluído', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao excluir médico';
      toast(msg, 'error');
    },
  });

  const excluirVarios = useMutation({
    mutationFn: (ids: string[]) => medicosService.excluirLote(ids),
    onSuccess: (resultado) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setSelecionados(new Set());
      setConfirmacao(null);
      setExcluirLoteResultado(resultado);
      if (resultado.bloqueados.length > 0) {
        toast(`${resultado.excluidos} excluído(s); ${resultado.bloqueados.length} bloqueado(s)`, 'info');
      } else {
        toast(`${resultado.excluidos} médico(s) excluído(s)`, 'success');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao excluir médicos';
      toast(msg, 'error');
    },
  });

  if (modo.tipo === 'novo') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Novo médico" onVoltar={() => setModo({ tipo: 'lista' })} />
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <MedicoForm salvando={criar.isPending} onSubmit={(dados) => criar.mutate(dados)} />
        </div>
      </section>
    );
  }

  if (modo.tipo === 'editar') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Editar médico" onVoltar={() => setModo({ tipo: 'lista' })} />
        <p className="text-sm text-cc-ink-2 -mt-3">{modo.medico.nome}</p>
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <MedicoForm
            inicial={modo.medico}
            exigeMotivo={!modo.medico.necessitaConfiguracao}
            salvando={atualizar.isPending}
            onSubmit={(dados, motivo) =>
              atualizar.mutate({
                id: modo.medico.id,
                p: {
                  ...dados,
                  motivo,
                  // Se era stub, marca como configurado ao salvar
                  ...(modo.medico.necessitaConfiguracao ? { necessitaConfiguracao: false } : {}),
                },
              })
            }
          />
        </div>
        <div>
          <Link href={`/medicos/${modo.medico.id}/historico`} className="link-action">
            Ver histórico de alterações
          </Link>
        </div>
      </section>
    );
  }

  const termoBusca = normalizarBusca(busca.trim());
  const medicosFiltrados = (medicos ?? []).filter((m) => {
    if (termoBusca) {
      const alvo = normalizarBusca(`${m.nome} ${m.cpf ?? ''}`);
      if (!alvo.includes(termoBusca)) return false;
    }
    if (filtroStatus === 'todos') return true;
    const status = calcularStatus(m);
    if (filtroStatus === 'aguardando') return status === 'aguardando';
    if (filtroStatus === 'ativos') return status === 'ativo';
    if (filtroStatus === 'inativos') return status === 'inativo';
    if (filtroStatus === 'cobranca_incompleta') return status === 'cobranca_incompleta';
    return true;
  });

  const totalPaginas = Math.max(1, Math.ceil(medicosFiltrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const medicosExibidos = medicosFiltrados.slice(
    (paginaAtual - 1) * POR_PAGINA,
    paginaAtual * POR_PAGINA,
  );

  function atualizarBusca(v: string) {
    setBusca(v);
    setPagina(1);
  }
  function atualizarFiltro(v: FiltroStatus) {
    setFiltroStatus(v);
    setPagina(1);
  }

  function alternarSelecao(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const idsExibidos = medicosExibidos.map((m) => m.id);
  const todosExibidosSelecionados =
    idsExibidos.length > 0 && idsExibidos.every((id) => selecionados.has(id));

  function alternarSelecionarPagina() {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (todosExibidosSelecionados) {
        for (const id of idsExibidos) next.delete(id);
      } else {
        for (const id of idsExibidos) next.add(id);
      }
      return next;
    });
  }

  const medicosPorId = new Map((medicos ?? []).map((m) => [m.id, m]));
  const nomesSelecionados = [...selecionados]
    .map((id) => medicosPorId.get(id)?.nome)
    .filter((n): n is string => Boolean(n));

  return (
    <section className="space-y-5">
      {syncRelatorio && (
        <SyncModal relatorio={syncRelatorio} onClose={() => setSyncRelatorio(null)} />
      )}

      {confirmacao && (
        <ConfirmDialog
          titulo={confirmacao.tipo === 'unico' ? 'Excluir médico' : `Excluir ${confirmacao.ids.length} médicos`}
          mensagem={
            confirmacao.tipo === 'unico'
              ? `Tem certeza que deseja excluir permanentemente "${confirmacao.medico.nome}"? Todo o histórico de configuração desse médico também será apagado.`
              : `Tem certeza que deseja excluir permanentemente estes ${confirmacao.ids.length} médicos? Médicos com execuções financeiras vinculadas serão bloqueados automaticamente e reportados.`
          }
          itens={confirmacao.tipo === 'lote' ? nomesSelecionados : undefined}
          confirmando={excluirUm.isPending || excluirVarios.isPending}
          onCancel={() => setConfirmacao(null)}
          onConfirm={() => {
            if (confirmacao.tipo === 'unico') excluirUm.mutate(confirmacao.medico.id);
            else excluirVarios.mutate(confirmacao.ids);
          }}
        />
      )}

      <div className="page-header">
        <h1 className="page-title">Médicos</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => sincronizar.mutate()}
            disabled={sincronizar.isPending}
            className="btn btn-primary btn-sm"
          >
            {sincronizar.isPending ? 'Sincronizando...' : 'Sincronizar com sistema web'}
          </button>
          <a
            href="/templates/medicos-modelo.xlsx"
            download
            className="btn btn-primary btn-sm"
          >
            Baixar modelo Excel
          </a>
          <label className={`btn btn-primary btn-sm cursor-pointer ${importar.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {importar.isPending ? 'Importando...' : 'Importar Planilha'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={importar.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setImportResult(null);
                  setErro(null);
                  importar.mutate(f);
                }
              }}
            />
          </label>
          <button
            onClick={() => {
              setErro(null);
              setImportResult(null);
              setModo({ tipo: 'novo' });
            }}
            className="btn-primary btn-sm btn"
          >
            Novo médico
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => atualizarBusca(e.target.value)}
          placeholder="Buscar por nome ou CPF..."
          className="input max-w-xs"
        />
        <select
          value={filtroStatus}
          onChange={(e) => atualizarFiltro(e.target.value as FiltroStatus)}
          className="input w-auto"
        >
          {FILTRO_OPCOES.map((op) => (
            <option key={op.valor} value={op.valor}>
              {op.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-cc-muted">
          {medicosFiltrados.length} médico{medicosFiltrados.length !== 1 ? 's' : ''}
        </span>
      </div>

      {erro && <p role="alert" className="alert-error">{erro}</p>}

      {importResult && (
        <div className={importResult.erros.length === 0 ? 'alert-success' : 'alert-warning'}>
          <p className="font-medium">
            Importação concluída: {importResult.criados} criado{importResult.criados !== 1 ? 's' : ''}.
            {importResult.erros.length > 0 && ` ${importResult.erros.length} erro(s) encontrado(s).`}
          </p>
          {importResult.erros.length > 0 && (
            <ul className="mt-2 list-disc pl-4 space-y-1 text-xs">
              {importResult.erros.map((e) => (
                <li key={`${e.linha}-${e.cpf}`}>
                  Linha {e.linha} (CPF {e.cpf}): {e.erro}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setImportResult(null)} className="mt-2 text-xs underline underline-offset-2">
            Fechar
          </button>
        </div>
      )}

      {excluirLoteResultado && (
        <div className={excluirLoteResultado.bloqueados.length === 0 ? 'alert-success' : 'alert-warning'}>
          <p className="font-medium">
            Exclusão concluída: {excluirLoteResultado.excluidos} excluído{excluirLoteResultado.excluidos !== 1 ? 's' : ''}.
            {excluirLoteResultado.bloqueados.length > 0 &&
              ` ${excluirLoteResultado.bloqueados.length} bloqueado(s).`}
          </p>
          {excluirLoteResultado.bloqueados.length > 0 && (
            <ul className="mt-2 list-disc pl-4 space-y-1 text-xs">
              {excluirLoteResultado.bloqueados.map((b) => (
                <li key={b.id}>
                  {b.nome}: {b.motivo}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setExcluirLoteResultado(null)} className="mt-2 text-xs underline underline-offset-2">
            Fechar
          </button>
        </div>
      )}

      {/* Banner: médicos aguardando configuração */}
      {(() => {
        const pendentes = (medicos ?? []).filter((m) => m.necessitaConfiguracao);
        if (pendentes.length === 0) return null;
        return (
          <div className="alert-warning flex items-start gap-3">
            <span className="mt-0.5 text-base">!</span>
            <div>
              <p className="font-medium">
                {pendentes.length} médico{pendentes.length !== 1 ? 's' : ''} descoberto{pendentes.length !== 1 ? 's' : ''} via sistema da Carmem aguardam configuração.
              </p>
              <p className="mt-0.5 text-xs opacity-80">
                Configure os parâmetros de faturamento para que entrem no próximo cálculo.
              </p>
            </div>
          </div>
        );
      })()}

      {selecionados.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-cc-accent/30 bg-cc-accent-soft px-4 py-2.5">
          <span className="text-sm font-medium text-cc-ink">
            {selecionados.size} selecionado{selecionados.size !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelecionados(new Set())} className="btn-ghost btn btn-sm">
              Limpar seleção
            </button>
            <button
              onClick={() => setConfirmacao({ tipo: 'lote', ids: [...selecionados] })}
              className="btn-danger btn btn-sm"
            >
              Excluir selecionados ({selecionados.size})
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : isError ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-cc-danger">Não foi possível carregar a lista de médicos. Recarregue a página.</p>
        </div>
      ) : medicosExibidos.length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
          title={medicosFiltrados.length === 0 && (busca || filtroStatus !== 'todos') ? 'Nenhum médico encontrado' : 'Nenhum médico cadastrado ainda'}
          description={
            medicosFiltrados.length === 0 && (busca || filtroStatus !== 'todos')
              ? 'Ajuste a busca ou o filtro para ver outros resultados.'
              : 'Cadastre manualmente ou importe uma planilha para começar.'
          }
          action={
            <button onClick={() => setModo({ tipo: 'novo' })} className="btn-primary btn-sm btn">
              Novo médico
            </button>
          }
        />
      ) : (
        <>
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead className="border-b border-cc-hairline bg-cc-surface-2">
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={todosExibidosSelecionados}
                      onChange={alternarSelecionarPagina}
                      className="rounded border-cc-hairline accent-cc-accent"
                      aria-label="Selecionar todos os médicos desta página"
                    />
                  </th>
                  <th>Nome</th>
                  <th>CPF</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {medicosExibidos.map((m) => {
                  const status = calcularStatus(m);
                  const pendencias = pendenciasDoMedico(m);
                  const mostrarAvisoCadastral = status === 'ativo' && pendencias.length > 0;
                  return (
                    <tr
                      key={m.id}
                      onClick={() => {
                        setErro(null);
                        setModo({ tipo: 'editar', medico: m });
                      }}
                      className={`cursor-pointer ${status === 'aguardando' ? 'opacity-70' : ''}`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selecionados.has(m.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => alternarSelecao(m.id)}
                          className="rounded border-cc-hairline accent-cc-accent"
                          aria-label={`Selecionar ${m.nome}`}
                        />
                      </td>
                      <td className="font-medium">
                        {m.nome}
                        {mostrarAvisoCadastral && (
                          <span
                            className="ml-1.5 inline-block text-cc-warning"
                            title={pendencias.join('\n')}
                          >
                            ⓘ
                          </span>
                        )}
                      </td>
                      <td className="font-mono text-cc-ink-2 tabular">{m.cpf ? formatCpf(m.cpf) : '—'}</td>
                      <td>
                        {/* Modo percentual (Story 6.2): o TIPO/classe não define o preço — badge do modo no lugar. */}
                        {m.modoCobranca === 'percentual_producao' ? (
                          <span className="badge-amber" title={`Cobrança por percentual da produção (${m.percentualProducao ?? '?'}%)`}>
                            {m.percentualProducao ?? '?'}% produção
                          </span>
                        ) : m.necessitaConfiguracao ? (
                          <span className="text-cc-muted">—</span>
                        ) : (
                          <span className="badge-slate">{tipoSeguro(m)}</span>
                        )}
                      </td>
                      <td>
                        <span className={STATUS_INFO[status].badge}>{STATUS_INFO[status].label}</span>
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          <span className="link-action">
                            {m.necessitaConfiguracao ? 'Configurar' : 'Editar'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmacao({ tipo: 'unico', medico: m });
                            }}
                            className="text-xs font-medium text-cc-danger hover:underline"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-sm text-cc-ink-2">
              <span>
                Página {paginaAtual} de {totalPaginas}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={paginaAtual <= 1}
                  className="btn-ghost btn btn-sm"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                  disabled={paginaAtual >= totalPaginas}
                  className="btn-ghost btn btn-sm"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function formatCpf(cpf: string): string {
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function tipoSeguro(m: Medico): string {
  try {
    return String(tipoDoMedico(m));
  } catch {
    return 'n/d';
  }
}

function PageHeader({ titulo, onVoltar }: { titulo: string; onVoltar: () => void }) {
  return (
    <div className="page-header">
      <h1 className="page-title">{titulo}</h1>
      <button onClick={onVoltar} className="btn-ghost btn btn-sm">
        Voltar à lista
      </button>
    </div>
  );
}
