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

export function ClientesContabilidadeManager() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<ClienteContabilidade | null>(null);
  const [importResult, setImportResult] = useState<ImportarResultado | null>(null);
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
        toast(`${resultado.criados} cliente(s) importado(s) com sucesso`, 'success');
      } else {
        toast(`Importação com ${resultado.erros.length} erro(s) — veja os detalhes`, 'info');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro na importação';
      setErro(msg);
      toast(msg, 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const excluir = useMutation({
    mutationFn: (id: string) => clientesContabilidadeService.excluir(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clientes() });
      setConfirmacao(null);
      toast('Cliente excluído', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao excluir cliente';
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

  return (
    <section className="space-y-5">
      {confirmacao && (
        <ConfirmDialog
          titulo="Excluir cliente contábil"
          mensagem={`Tem certeza que deseja excluir permanentemente "${confirmacao.nome}"?`}
          confirmando={excluir.isPending}
          onCancel={() => setConfirmacao(null)}
          onConfirm={() => excluir.mutate(confirmacao.id)}
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

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : isError ? (
        <p className="alert-error" role="alert">Falha ao carregar clientes contábeis.</p>
      ) : !clientes || clientes.length === 0 ? (
        <EmptyState
          title="Nenhum cliente contábil cadastrado"
          description="Cadastre o primeiro cliente para lançar faturamento e emitir boletos de honorários contábeis."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cc-hairline text-left text-cc-muted">
                <th className="py-2.5 px-4 font-medium">Nome</th>
                <th className="py-2.5 px-4 font-medium">Regime</th>
                <th className="py-2.5 px-4 font-medium">Modo de cobrança</th>
                <th className="py-2.5 px-4 font-medium">Conta emissora</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-cc-hairline last:border-0 hover:bg-cc-surface-2/50 cursor-pointer"
                  onClick={() => router.push(`/clientes-contabilidade/${c.id}`)}
                >
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
                    {/* Ações rápidas na própria linha (feedback do dono, 2026-07-24) — não exige
                        abrir o hub pra emitir/lançar faturamento dos casos comuns. */}
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/clientes-contabilidade/${c.id}/execucao`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="link-action"
                      >
                        Emissão
                      </Link>
                      {c.modoCobranca === 'faixa_faturamento' && (
                        <Link
                          href={`/clientes-contabilidade/${c.id}/faturamento`}
                          onClick={(ev) => ev.stopPropagation()}
                          className="link-action"
                        >
                          Faturamento
                        </Link>
                      )}
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setConfirmacao(c);
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
