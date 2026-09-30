'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Execucao, StatusExecucao } from '@cobranca/shared';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { brl, normalizarBusca } from '@/lib/formato';
import { competenciaPorExtenso } from '@/lib/competencia';

// Histórico de emissões (reorganização UX 2026-09-30). O dono achava a tela antiga confusa:
// "execução" misturado com "emissão", mês em AAAA-MM, cinco filtros e grupos que só diziam
// "131 execuções". Agora cada mês abre com um resumo, a lista fala a língua do escritório
// (o quê foi emitido, quando, por quem) e só sobraram a busca e o filtro de serviço.
// Os nomes internos (Execucao, execucoesService) seguem os mesmos.

function StatusBadge({ status }: { status: StatusExecucao }) {
  if (status === 'concluido') return <span className="badge-green">Concluída</span>;
  if (status === 'processando') return <span className="badge-amber">Processando</span>;
  return <span className="badge-red">Erro</span>;
}

type Servico = 'cobrancas' | 'contabilidade';
type FiltroServico = 'todos' | Servico;

const FILTRO_SERVICO_OPCOES: { valor: FiltroServico; label: string }[] = [
  { valor: 'todos', label: 'Todos' },
  { valor: 'cobrancas', label: 'Cobranças médicas' },
  { valor: 'contabilidade', label: 'Contabilidade' },
];

/** Execução de cliente contábil (individual ou em lote) = Contabilidade; o resto (médicos/empresas) = Cobranças. */
function servicoDaExecucao(e: Execucao): Servico {
  return e.clienteContabilidadeId || e.clientesContabilidadeIds?.length ? 'contabilidade' : 'cobrancas';
}

/**
 * O que foi emitido, em uma linha. Emissão com 1 resultado só (modo "Por médico" da tela de
 * emissão, ou um cliente contábil avulso) é individual e mostra o nome; o resto é lote.
 */
function descricaoDaExecucao(e: Execucao): { titulo: string; detalhe: string | null } {
  if (servicoDaExecucao(e) === 'contabilidade') {
    if (e.ehAdicional) return { titulo: 'Adicional semestral', detalhe: e.medicoNome ?? null };
    if (e.clienteContabilidadeId || e.totalMedicos === 1) {
      return { titulo: e.medicoNome ?? 'Cliente contábil', detalhe: 'Contabilidade · individual' };
    }
    const n = e.clientesContabilidadeIds?.length ?? e.totalMedicos ?? 0;
    return { titulo: 'Lote de contabilidade', detalhe: `${n} cliente${n !== 1 ? 's' : ''}` };
  }
  if (e.totalMedicos === 1) return { titulo: e.medicoNome ?? 'Médico', detalhe: 'Individual' };
  if (e.empresaId) return { titulo: 'Emissão por empresa', detalhe: null };
  const n = e.totalMedicos ?? 0;
  return { titulo: 'Lote do mês', detalhe: `${n} médico${n !== 1 ? 's' : ''}` };
}

/** Contagens de uma emissão, só as que têm algo — "110 ok · 6 a revisar · 9 sem produção". */
function resultadoDaExecucao(e: Execucao): string {
  const partes: string[] = [];
  if (e.totalOk) partes.push(`${e.totalOk} ok`);
  if (e.totalAlerta) partes.push(`${e.totalAlerta} a revisar`);
  if (e.totalSemDados) partes.push(`${e.totalSemDados} sem produção`);
  if (e.totalAcumulado) partes.push(`${e.totalAcumulado} acumulado${e.totalAcumulado !== 1 ? 's' : ''}`);
  return partes.length ? partes.join(' · ') : '—';
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "ana@escritorio.com" → "ana": o e-mail inteiro não ajuda a reconhecer quem emitiu. */
function autor(email: string | null | undefined): string {
  return email?.split('@')[0] || '—';
}

function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

export function HistoricoExecucoes() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.execucoes(),
    queryFn: () => execucoesService.listar(),
  });

  const [busca, setBusca] = useState('');
  const [filtroServico, setFiltroServico] = useState<FiltroServico>('todos');
  const [expandidos, setExpandidos] = useState<Set<string> | null>(null);

  const execucoes = useMemo(() => data ?? [], [data]);

  const termoBusca = normalizarBusca(busca.trim());
  const execucoesFiltradas = execucoes.filter((e) => {
    if (termoBusca) {
      const alvos = [e.competencia, competenciaPorExtenso(e.competencia), e.medicoNome ?? ''];
      if (!alvos.some((a) => normalizarBusca(a).includes(termoBusca))) return false;
    }
    if (filtroServico !== 'todos' && servicoDaExecucao(e) !== filtroServico) return false;
    return true;
  });

  // Agrupa por competência — cada mês pode ter várias emissões (lote + individuais +
  // reprocessamentos), já que não há unique constraint em competencia.
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

  // Mês mais recente expandido por padrão na primeira carga; depois disso, respeita o toggle do usuário.
  const primeiroGrupo = grupos[0]?.[0];
  const expandidosEfetivos = expandidos ?? new Set(primeiroGrupo ? [primeiroGrupo] : []);

  function toggleGrupo(competencia: string) {
    const proximo = new Set(expandidosEfetivos);
    if (proximo.has(competencia)) proximo.delete(competencia);
    else proximo.add(competencia);
    setExpandidos(proximo);
  }

  const filtroAtivo = Boolean(busca || filtroServico !== 'todos');

  if (isLoading) return <TableSkeleton rows={5} cols={6} />;

  if (execucoes.length === 0) {
    return (
      <EmptyState
        icon={
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        }
        title="Nenhuma emissão registrada ainda"
        description="Emita os boletos de uma competência para ela aparecer aqui."
        action={
          <Link href="/emissao" className="btn-primary btn-sm btn">
            Emitir boletos
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar médico, cliente ou mês..."
          aria-label="Buscar médico, cliente ou mês"
          className="input max-w-xs"
        />
        <div
          role="group"
          aria-label="Filtrar por serviço"
          className="inline-flex rounded-lg border border-cc-hairline bg-cc-surface-2 p-1"
        >
          {FILTRO_SERVICO_OPCOES.map((op) => (
            <button
              key={op.valor}
              type="button"
              aria-pressed={filtroServico === op.valor}
              onClick={() => setFiltroServico(op.valor)}
              className={`btn btn-sm ${filtroServico === op.valor ? 'btn-primary' : 'btn-ghost'}`}
            >
              {op.label}
            </button>
          ))}
        </div>
      </div>

      {grupos.length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          }
          title="Nenhuma emissão encontrada"
          description="Ajuste a busca ou o filtro de serviço para ver outros resultados."
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
              onAbrir={(id) => router.push(`/emissoes/${id}`)}
            />
          ))}
        </div>
      )}
      {filtroAtivo && grupos.length > 0 && (
        <p className="text-xs text-cc-muted">
          Exibindo {execucoesFiltradas.length} de {execucoes.length} emissões.
        </p>
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
  // Resumo do mês só com contagens: somar `totalGeralValor` entre emissões contaria duas vezes
  // quem foi reprocessado (lote + individual do mesmo médico). Valor e boletos por mês pedem
  // um resumo calculado no servidor (próxima etapa).
  const comErro = itens.filter((e) => e.status === 'erro').length;
  const processando = itens.filter((e) => e.status === 'processando').length;
  const medicas = itens.filter((e) => servicoDaExecucao(e) === 'cobrancas').length;
  const contabeis = itens.length - medicas;
  const composicao = [
    medicas ? plural(medicas, 'cobrança médica', 'cobranças médicas') : null,
    contabeis ? plural(contabeis, 'de contabilidade', 'de contabilidade') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expandido}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-semibold text-cc-ink">{competenciaPorExtenso(competencia)}</span>
            <span className="badge-slate">{plural(itens.length, 'emissão', 'emissões')}</span>
            {comErro > 0 && <span className="badge-red">{plural(comErro, 'com erro', 'com erro')}</span>}
            {processando > 0 && <span className="badge-amber">{processando} processando</span>}
          </span>
          <span className="text-xs text-cc-muted">
            {composicao}
            {itens[0] && ` · última em ${dataHora(itens[0].iniciadoEm)}`}
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
                <th>Data</th>
                <th>Emissão</th>
                <th>Situação</th>
                <th>Resultado</th>
                <th className="text-right">Valor</th>
                <th>Por</th>
                <th className="text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((e) => {
                const { titulo, detalhe } = descricaoDaExecucao(e);
                return (
                  <tr key={e.id} onClick={() => onAbrir(e.id)} className="cursor-pointer">
                    <td className="whitespace-nowrap tabular text-cc-ink-2">{dataHora(e.iniciadoEm)}</td>
                    <td>
                      <span className="text-cc-ink">{titulo}</span>
                      {detalhe && <span className="block text-2xs text-cc-muted">{detalhe}</span>}
                    </td>
                    <td>
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="text-cc-ink-2">{resultadoDaExecucao(e)}</td>
                    <td className="text-right tabular font-medium">{brl(e.totalGeralValor)}</td>
                    <td className="max-w-[10rem] truncate text-cc-muted" title={e.iniciadoPorEmail ?? undefined}>
                      {autor(e.iniciadoPorEmail)}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/emissoes/${e.id}`}
                        className="link-action"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
