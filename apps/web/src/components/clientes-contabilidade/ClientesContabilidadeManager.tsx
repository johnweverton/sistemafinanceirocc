'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClienteContabilidade } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import {
  clientesContabilidadeService,
  clienteContabilidadeQueryKeys,
  type NovoClienteContabilidadePayload,
  type AtualizarClienteContabilidadePayload,
} from '@/services/clientes-contabilidade';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ClienteContabilidadeForm } from './ClienteContabilidadeForm';

type Modo = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'editar'; cliente: ClienteContabilidade };

export function ClientesContabilidadeManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<ClienteContabilidade | null>(null);

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

  const atualizar = useMutation({
    mutationFn: ({ id, p }: { id: string; p: AtualizarClienteContabilidadePayload }) =>
      clientesContabilidadeService.atualizar(id, p),
    onSuccess: (c, vars) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clientes() });
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clienteHistorico(vars.id) });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Alterações de ${c.nome} salvas`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
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

  if (modo.tipo === 'editar') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Editar cliente contábil" onVoltar={() => setModo({ tipo: 'lista' })} />
        <p className="text-sm text-cc-ink-2 -mt-3">{modo.cliente.nome}</p>
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <ClienteContabilidadeForm
            inicial={modo.cliente}
            exigeMotivo
            salvando={atualizar.isPending}
            onSubmit={(dados, motivo) => atualizar.mutate({ id: modo.cliente.id, p: { ...dados, motivo } })}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          {modo.cliente.modoCobranca === 'faixa_faturamento' && (
            <Link href={`/clientes-contabilidade/${modo.cliente.id}/faturamento`} className="link-action">
              Lançar faturamento
            </Link>
          )}
          <Link href={`/clientes-contabilidade/${modo.cliente.id}/historico`} className="link-action">
            Ver histórico de alterações
          </Link>
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
        <button onClick={() => setModo({ tipo: 'novo' })} className="btn-primary btn btn-sm">
          Novo cliente
        </button>
      </div>

      {erro && <p role="alert" className="alert-error">{erro}</p>}

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
                  onClick={() => setModo({ tipo: 'editar', cliente: c })}
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
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setConfirmacao(c);
                      }}
                      className="text-xs font-medium text-cc-danger hover:underline"
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
