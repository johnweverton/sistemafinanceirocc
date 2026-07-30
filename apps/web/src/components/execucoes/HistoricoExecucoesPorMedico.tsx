'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ExecucaoResumoMedico, StatusResultado } from '@cobranca/shared';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

const POR_PAGINA = 25;

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizarBusca(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function ResultadoBadge({ status }: { status: StatusResultado }) {
  if (status === 'ok') return <span className="badge-green">Ok</span>;
  if (status === 'alerta') return <span className="badge-amber">Alerta</span>;
  return <span className="badge-slate">Sem dados</span>;
}

/** Chave estável para agrupar/expandir — cai para cpf quando o médico não está vinculado ao cadastro. */
function chaveDoMedico(m: ExecucaoResumoMedico): string {
  return m.medicoId ?? `cpf:${m.cpf}`;
}

export function HistoricoExecucoesPorMedico() {
  const { data, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.resumoPorMedico(),
    queryFn: () => execucoesService.resumoPorMedico(),
  });

  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [expandido, setExpandido] = useState<string | null>(null);

  const resumo = data ?? [];

  const termoBusca = normalizarBusca(busca.trim());
  const resumoFiltrado = resumo.filter((m) => {
    if (!termoBusca) return true;
    return normalizarBusca(`${m.nome} ${m.cpf}`).includes(termoBusca);
  });

  const totalPaginas = Math.max(1, Math.ceil(resumoFiltrado.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const resumoExibido = resumoFiltrado.slice(
    (paginaAtual - 1) * POR_PAGINA,
    paginaAtual * POR_PAGINA,
  );

  function atualizarBusca(v: string) {
    setBusca(v);
    setPagina(1);
  }

  function toggleExpandido(chave: string) {
    setExpandido((atual) => (atual === chave ? null : chave));
  }

  if (isLoading) return <TableSkeleton rows={5} cols={6} />;

  if (resumo.length === 0) {
    return (
      <EmptyState
        icon={
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        }
        title="Nenhum médico processado ainda"
        description="Dispare uma execução para começar a ver o histórico por médico aqui."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => atualizarBusca(e.target.value)}
          placeholder="Buscar por nome ou CPF..."
          aria-label="Buscar médico por nome ou CPF"
          className="input max-w-xs"
        />
        <span className="text-xs text-cc-muted">
          {resumoFiltrado.length} médico{resumoFiltrado.length !== 1 ? 's' : ''}
        </span>
      </div>

      {resumoFiltrado.length === 0 ? (
        <EmptyState
          title="Nenhum médico encontrado"
          description="Ajuste a busca para ver outros resultados."
        />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead className="border-b border-cc-hairline bg-cc-surface-2">
                <tr>
                  <th>Médico</th>
                  <th>Última competência</th>
                  <th>Status</th>
                  <th className="text-right">Valor</th>
                  <th className="text-right">Emissões</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {resumoExibido.map((m) => {
                  const chave = chaveDoMedico(m);
                  return (
                    <LinhaMedico
                      key={chave}
                      medico={m}
                      chave={chave}
                      expandido={expandido === chave}
                      onToggle={() => toggleExpandido(chave)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-xs text-cc-muted">
              <span>Página {paginaAtual} de {totalPaginas}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary btn btn-sm"
                  disabled={paginaAtual <= 1}
                  onClick={() => setPagina(paginaAtual - 1)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="btn-secondary btn btn-sm"
                  disabled={paginaAtual >= totalPaginas}
                  onClick={() => setPagina(paginaAtual + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LinhaMedico({
  medico,
  chave,
  expandido,
  onToggle,
}: {
  medico: ExecucaoResumoMedico;
  chave: string;
  expandido: boolean;
  onToggle: () => void;
}) {
  const { data: historico, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.historicoMedico(chave),
    queryFn: () =>
      execucoesService.historicoMedico(
        medico.medicoId ? { medicoId: medico.medicoId } : { cpf: medico.cpf },
      ),
    enabled: expandido,
  });

  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle}>
        <td className="font-medium text-cc-ink">{medico.nome}</td>
        <td className="font-mono tabular text-cc-ink-2">{medico.ultimaCompetencia}</td>
        <td>
          <ResultadoBadge status={medico.ultimoStatusResultado} />
        </td>
        <td className="text-right tabular font-medium">{brl(medico.ultimoValor)}</td>
        <td className="text-right tabular text-cc-muted">{medico.qtdExecucoes}</td>
        <td className="text-right">
          <Link
            href={`/execucoes/${medico.ultimaExecucaoId}`}
            className="link-action"
            onClick={(ev) => ev.stopPropagation()}
          >
            Abrir
          </Link>
        </td>
      </tr>
      {expandido && (
        <tr>
          <td colSpan={6} className="bg-cc-surface-2 p-0">
            {isLoading ? (
              <p className="p-4 text-sm text-cc-muted">Carregando histórico…</p>
            ) : !historico || historico.length === 0 ? (
              <p className="p-4 text-sm text-cc-muted">Nenhuma ocorrência encontrada.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead className="border-b border-cc-hairline">
                  <tr>
                    <th>Competência</th>
                    <th>Status execução</th>
                    <th>Status resultado</th>
                    <th className="text-right">Valor</th>
                    <th className="text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((h) => (
                    <tr key={h.execucaoId}>
                      <td className="font-mono tabular">{h.competencia}</td>
                      <td className="text-cc-ink-2">{h.execucaoStatus}</td>
                      <td>
                        <ResultadoBadge status={h.statusResultado} />
                      </td>
                      <td className="text-right tabular">{brl(h.totalValor)}</td>
                      <td className="text-right">
                        <Link href={`/execucoes/${h.execucaoId}`} className="link-action">
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
