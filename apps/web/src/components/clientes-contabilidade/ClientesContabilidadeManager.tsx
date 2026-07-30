'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClienteContabilidade } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import {
  clientesContabilidadeService,
  clienteContabilidadeQueryKeys,
  type NovoClienteContabilidadePayload,
  type ImportarResultado,
  type ExclusaoLoteResultado,
} from '@/services/clientes-contabilidade';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ClienteContabilidadeForm } from './ClienteContabilidadeForm';

// Clicar na linha leva direto para a página de detalhe (/clientes-contabilidade/[id]), que é o
// hub único de ações (Emissão/Faturamento/Editar cadastro/Histórico) — feedback do dono
// (2026-07-24): as ações estavam "lá embaixo" só depois de abrir o cadastro pra edição. O modo
// 'editar' saiu deste componente; cadastro só é editado dentro do hub (DetalheCliente.tsx).
type Modo = { tipo: 'lista' } | { tipo: 'novo' };
type Confirmacao = { tipo: 'unico'; cliente: ClienteContabilidade } | { tipo: 'lote'; ids: string[] };

function normalizarBusca(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function ClientesContabilidadeManager() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [importResult, setImportResult] = useState<ImportarResultado | null>(null);
  const [excluirLoteResultado, setExcluirLoteResultado] = useState<ExclusaoLoteResultado | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: clientes, isLoading, isError } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.clientes(),
    queryFn: () => clientesContabilidadeService.listar(),
    retry: (count, err) => {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) return false;
      return count < 2;
    },
  });

  const criar = useMutation({
    mutationFn: (p: NovoClienteContabilidadePayload) => clientesContabilidadeService.criar(p),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clientes() });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Cliente ${c.nome} cadastrado`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const importar = useMutation({
    mutationFn: (arquivo: File) => clientesContabilidadeService.importar(arquivo),
    onSuccess: (resultado) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clientes() });
      setImportResult(resultado);
      setErro(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (resultado.erros.length === 0) {
        toast(
          `${resultado.criados} cliente(s) importado(s), ${resultado.atualizados} atualizado(s)`,
          'success',
        );
      } else {
        toast(`Importação com ${resultado.erros.length} erro(s). Veja os detalhes.`, 'info');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro na importação';
      setErro(msg);
      toast(msg, 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const excluirUm = useMutation({
    mutationFn: (id: string) => clientesContabilidadeService.excluir(id),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clientes() });
      setSelecionados((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setConfirmacao(null);
      toast('Cliente excluído', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao excluir cliente';
      toast(msg, 'error');
    },
  });

  const excluirVarios = useMutation({
    mutationFn: (ids: string[]) => clientesContabilidadeService.excluirLote(ids),
    onSuccess: (resultado) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clientes() });
      setSelecionados(new Set());
      setConfirmacao(null);
      setExcluirLoteResultado(resultado);
      if (resultado.bloqueados.length > 0) {
        toast(`${resultado.excluidos} excluído(s); ${resultado.bloqueados.length} bloqueado(s)`, 'info');
      } else {
        toast(`${resultado.excluidos} cliente(s) excluído(s)`, 'success');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao excluir clientes';
      toast(msg, 'error');
    },
  });

  if (modo.tipo === 'novo') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Novo cliente contábil" onVoltar={() => setModo({ tipo: 'lista' })} />
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <ClienteContabilidadeForm salvando={criar.isPending} onSubmit={(dados) => criar.mutate(dados)} />
        </div>
      </section>
    );
  }

  const termoBusca = normalizarBusca(busca.trim());
  const clientesFiltrados = (clientes ?? []).filter((c) => {
    if (!termoBusca) return true;
    return normalizarBusca(c.nome).includes(termoBusca);
  });

  function atualizarBusca(v: string) {
    setBusca(v);
  }

  function alternarSelecao(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const idsExibidos = clientesFiltrados.map((c) => c.id);
  const todosExibidosSelecionados =
    idsExibidos.length > 0 && idsExibidos.every((id) => selecionados.has(id));

  function alternarSelecionarTodos() {
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

  const clientesPorId = new Map((clientes ?? []).map((c) => [c.id, c]));
  const nomesSelecionados = [...selecionados]
    .map((id) => clientesPorId.get(id)?.nome)
    .filter((n): n is string => Boolean(n));

  return (
    <section className="space-y-5">
      {confirmacao && (
        <ConfirmDialog
          titulo={confirmacao.tipo === 'unico' ? 'Excluir cliente contábil' : `Excluir ${confirmacao.ids.length} clientes`}
          mensagem={
            confirmacao.tipo === 'unico'
              ? `Tem certeza que deseja excluir permanentemente "${confirmacao.cliente.nome}"?`
              : `Tem certeza que deseja excluir permanentemente estes ${confirmacao.ids.length} clientes?`
          }
          itens={confirmacao.tipo === 'lote' ? nomesSelecionados : undefined}
          confirmando={excluirUm.isPending || excluirVarios.isPending}
          onCancel={() => setConfirmacao(null)}
          onConfirm={() => {
            if (confirmacao.tipo === 'unico') excluirUm.mutate(confirmacao.cliente.id);
            else excluirVarios.mutate(confirmacao.ids);
          }}
        />
      )}

      <div className="page-header">
        <h1 className="page-title">Clientes Contábeis</h1>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/templates/clientes-contabilidade-modelo.xlsx" download className="btn btn-primary btn-sm">
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
          <button onClick={() => setModo({ tipo: 'novo' })} className="btn-primary btn btn-sm">
            Novo cliente
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => atualizarBusca(e.target.value)}
          placeholder="Buscar por nome..."
          className="input max-w-xs"
        />
        <span className="text-xs text-cc-muted">
          {clientesFiltrados.length} cliente{clientesFiltrados.length !== 1 ? 's' : ''}
        </span>
      </div>

      {erro && <p role="alert" className="alert-error">{erro}</p>}

      {importResult && (
        <div className={importResult.erros.length === 0 ? 'alert-success' : 'alert-warning'}>
          <p className="font-medium">
            Importação concluída: {importResult.criados} criado{importResult.criados !== 1 ? 's' : ''},{' '}
            {importResult.atualizados} atualizado{importResult.atualizados !== 1 ? 's' : ''}.
            {importResult.erros.length > 0 && ` ${importResult.erros.length} erro(s) encontrado(s).`}
          </p>
          {importResult.erros.length > 0 && (
            <ul className="mt-2 list-disc pl-4 space-y-1 text-xs">
              {importResult.erros.map((e) => (
                <li key={`${e.linha}-${e.chave}`}>
                  Linha {e.linha} ({e.chave}): {e.erro}
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
        <TableSkeleton rows={5} cols={6} />
      ) : isError ? (
        <p className="alert-error" role="alert">Falha ao carregar clientes contábeis.</p>
      ) : clientesFiltrados.length === 0 ? (
        <EmptyState
          title={clientes && clientes.length > 0 ? 'Nenhum cliente encontrado' : 'Nenhum cliente contábil cadastrado'}
          description={
            clientes && clientes.length > 0
              ? 'Ajuste a busca para ver outros resultados.'
              : 'Cadastre o primeiro cliente para lançar faturamento e emitir boletos de honorários contábeis.'
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cc-hairline text-left text-cc-muted">
                <th className="w-10 py-2.5 px-4">
                  <input
                    type="checkbox"
                    checked={todosExibidosSelecionados}
                    onChange={alternarSelecionarTodos}
                    className="rounded border-cc-hairline accent-cc-accent"
                    aria-label="Selecionar todos os clientes"
                  />
                </th>
                <th className="py-2.5 px-4 font-medium">Nome</th>
                <th className="py-2.5 px-4 font-medium">Regime</th>
                <th className="py-2.5 px-4 font-medium">Modo de cobrança</th>
                <th className="py-2.5 px-4 font-medium">Conta emissora</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {clientesFiltrados.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-cc-hairline last:border-0 hover:bg-cc-surface-2/50 cursor-pointer"
                  onClick={() => router.push(`/clientes-contabilidade/${c.id}`)}
                >
                  <td className="py-2.5 px-4">
                    <input
                      type="checkbox"
                      checked={selecionados.has(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => alternarSelecao(c.id)}
                      className="rounded border-cc-hairline accent-cc-accent"
                      aria-label={`Selecionar ${c.nome}`}
                    />
                  </td>
                  <td className="py-2.5 px-4 font-medium text-cc-ink">{c.nome}</td>
                  <td className="py-2.5 px-4 text-cc-ink-2">{regimeLabel(c.regimeTributario)}</td>
                  <td className="py-2.5 px-4 text-cc-ink-2">
                    <span className="badge-slate">{modoCobrancaLabel(c.modoCobranca)}</span>
                  </td>
                  <td className="py-2.5 px-4 text-cc-ink-2">{CONTA_EMISSORA_LABEL[c.contaEmissora]}</td>
                  <td className="py-2.5 px-4">
                    <span className={c.ativo ? 'badge-green' : 'badge-slate'}>{c.ativo ? 'Ativo' : 'Inativo'}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {/* Ação rápida na própria linha (feedback do dono, 2026-07-24) — não exige
                        abrir o hub pra emitir. Para clientes faixa_faturamento, "Emissão" leva ao
                        fluxo combinado que já inclui o lançamento de faturamento (polimento UX,
                        2026-07-30 — antes havia um link "Faturamento" separado aqui). */}
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/clientes-contabilidade/${c.id}/execucao`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="link-action"
                      >
                        Emissão
                      </Link>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setConfirmacao({ tipo: 'unico', cliente: c });
                        }}
                        className="text-xs font-medium text-cc-danger hover:underline"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function regimeLabel(regime: string): string {
  return regime === 'lucro_presumido' ? 'Lucro Presumido' : 'Simples Nacional';
}

function modoCobrancaLabel(modo: string): string {
  return modo === 'fixo' ? 'Valor fixo' : 'Faixa de faturamento';
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
