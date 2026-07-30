'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Execucao, StatusExecucao } from '@cobranca/shared';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function StatusBadge({ status }: { status: StatusExecucao }) {
  if (status === 'concluido') return <span className="badge-green">Concluído</span>;
  if (status === 'processando') return <span className="badge-amber">Processando</span>;
  return <span className="badge-red">Erro</span>;
}

function normalizarBusca(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

type FiltroStatus = 'todos' | StatusExecucao;
type FiltroTipo = 'todos' | 'massa' | 'pontual';

const FILTRO_STATUS_OPCOES: { valor: FiltroStatus; label: string }[] = [
  { valor: 'todos', label: 'Todos os status' },
  { valor: 'concluido', label: 'Concluído' },
  { valor: 'processando', label: 'Processando' },
  { valor: 'erro', label: 'Erro' },
];

const FILTRO_TIPO_OPCOES: { valor: FiltroTipo; label: string }[] = [
  { valor: 'todos', label: 'Todos os tipos' },
  { valor: 'massa', label: 'Em massa' },
  { valor: 'pontual', label: 'Pontual' },
];

/** Execuções "por médico" (NovaExecucao) sempre disparam com 1 seleção só — sem batch nem lote. */
function tipoDaExecucao(e: Execucao): 'massa' | 'pontual' {
  return e.totalMedicos === 1 ? 'pontual' : 'massa';
}

export function HistoricoExecucoes() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.execucoes(),
    queryFn: () => execucoesService.listar(),
  });

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const [filtroCompetencia, setFiltroCompetencia] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string> | null>(null);

  const execucoes = useMemo(() => data ?? [], [data]);

  const competencias = useMemo(() => {
    const set = new Set(execucoes.map((e) => e.competencia));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [execucoes]);

  const termoBusca = normalizarBusca(busca.trim());
  const execucoesFiltradas = execucoes.filter((e) => {
    if (termoBusca && !normalizarBusca(e.competencia).includes(termoBusca)) return false;
    if (filtroStatus !== 'todos' && e.status !== filtroStatus) return false;
    if (filtroTipo !== 'todos' && tipoDaExecucao(e) !== filtroTipo) return false;
    if (filtroCompetencia && e.competencia !== filtroCompetencia) return false;
    return true;
  });

  // Agrupa por competência — cada grupo pode conter várias execuções (em massa + reprocessamentos
  // pontuais), já que não há unique constraint em competencia.
  const grupos = useMemo(() => {
    const map = new Map<string, Execucao[]>();
    for (const e of execucoesFiltradas) {
      const arr = map.get(e.competencia) ?? [];
      arr.push(e);
      map.set(e.competencia, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm));
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [execucoesFiltradas]);

  // Grupo mais recente expandido por padrão na primeira carga; depois disso, respeita o toggle do usuário.
  const primeiroGrupo = grupos[0]?.[0];
  const expandidosEfetivos = expandidos ?? new Set(primeiroGrupo ? [primeiroGrupo] : []);

  function toggleGrupo(competencia: string) {
    const proximo = new Set(expandidosEfetivos);
    if (proximo.has(competencia)) proximo.delete(competencia);
    else proximo.add(competencia);
    setExpandidos(proximo);
  }

  const filtroAtivo = Boolean(busca || filtroStatus !== 'todos' || filtroTipo !== 'todos' || filtroCompetencia);

  return (
    <>
      {isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : execucoes.length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
          title="Nenhuma execução registrada ainda"
          description="Dispare o processamento de uma competência para gerar o primeiro relatório."
          action={
            <Link href="/execucoes/nova" className="btn-primary btn-sm btn">
              Nova emissão
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por competência..."
              aria-label="Buscar por competência"
              className="input max-w-xs"
            />
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)}
              aria-label="Filtrar por status"
              className="input w-auto"
            >
              {FILTRO_STATUS_OPCOES.map((op) => (
                <option key={op.valor} value={op.valor}>{op.label}</option>
              ))}
            </select>
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)}
              aria-label="Filtrar por tipo"
              className="input w-auto"
            >
              {FILTRO_TIPO_OPCOES.map((op) => (
                <option key={op.valor} value={op.valor}>{op.label}</option>
              ))}
            </select>
            <select
              value={filtroCompetencia}
              onChange={(e) => setFiltroCompetencia(e.target.value)}
              aria-label="Filtrar por competência"
              className="input w-auto"
            >
              <option value="">Todas as competências</option>
              {competencias.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="text-xs text-cc-muted">
              {execucoesFiltradas.length} execuç{execucoesFiltradas.length !== 1 ? 'ões' : 'ão'}
            </span>
          </div>

          {grupos.length === 0 ? (
            <EmptyState
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              }
              title="Nenhuma execução encontrada"
              description="Ajuste a busca ou os filtros para ver outros resultados."
            />
          ) : (
            <div className="space-y-3">
              {grupos.map(([competencia, itens]) => (
                <GrupoCompetencia
                  key={competencia}
                  competencia={competencia}
                  itens={itens}
                  expandido={expandidosEfetivos.has(competencia)}
                  onToggle={() => toggleGrupo(competencia)}
                  onAbrir={(id) => router.push(`/execucoes/${id}`)}
                />
              ))}
            </div>
          )}
          {filtroAtivo && grupos.length > 0 && (
            <p className="text-xs text-cc-muted">
              Exibindo {execucoesFiltradas.length} de {execucoes.length} execuções.
            </p>
          )}
        </>
      )}
    </>
  );
}

function GrupoCompetencia({
  competencia,
  itens,
  expandido,
  onToggle,
  onAbrir,
}: {
  competencia: string;
  itens: Execucao[];
  expandido: boolean;
  onToggle: () => void;
  onAbrir: (id: string) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expandido}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <span className="font-mono font-semibold tabular text-cc-ink">{competencia}</span>
          <span className="badge-slate">
            {itens.length} execuç{itens.length !== 1 ? 'ões' : 'ão'}
          </span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-cc-muted transition-transform ${expandido ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expandido && (
        <div className="overflow-x-auto">
        <table className="data-table border-t border-cc-hairline">
          <thead className="border-b border-cc-hairline bg-cc-surface-2">
            <tr>
              <th>Tipo</th>
              <th>Status</th>
              <th className="text-right">Ok</th>
              <th className="text-right">Revisão</th>
              <th className="text-right">Sem dados</th>
              <th className="text-right">Total</th>
              <th>Disparado por</th>
              <th className="text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((e) => (
              <tr key={e.id} onClick={() => onAbrir(e.id)} className="cursor-pointer">
                <td>
                  <span className="badge-slate">{tipoDaExecucao(e) === 'massa' ? 'Em massa' : 'Pontual'}</span>
                </td>
                <td>
                  <StatusBadge status={e.status} />
                </td>
                <td className="text-right tabular text-cc-ink-2">{e.totalOk ?? '-'}</td>
                <td className="text-right tabular text-cc-warning">{e.totalAlerta ?? '-'}</td>
                <td className="text-right tabular text-cc-muted">{e.totalSemDados ?? '-'}</td>
                <td className="text-right tabular font-medium">{brl(e.totalGeralValor)}</td>
                <td className="max-w-[12rem] truncate text-cc-muted" title={e.iniciadoPorEmail ?? undefined}>
                  {e.iniciadoPorEmail ?? '—'}
                </td>
                <td className="text-right">
                  <Link
                    href={`/execucoes/${e.id}`}
                    className="link-action"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
