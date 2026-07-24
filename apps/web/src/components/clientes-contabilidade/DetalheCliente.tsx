'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import {
  clientesContabilidadeService,
  clienteContabilidadeQueryKeys,
  type AtualizarClienteContabilidadePayload,
} from '@/services/clientes-contabilidade';
import { reajusteAnualPendente } from '@/lib/reajuste-anual';
import { useToast } from '@/components/ui/Toast';
import { ClienteContabilidadeForm } from './ClienteContabilidadeForm';

// Hub único do cliente contábil (feedback do dono, 2026-07-24): clicar na linha da lista chega
// direto aqui, com as ações em destaque no topo — nada mais fica "lá embaixo" atrás de um
// formulário. Edição de cadastro vive aqui (toggle local), substituindo o antigo modo "editar"
// que existia dentro de ClientesContabilidadeManager.
export function DetalheCliente({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { data: cliente, isLoading: carregandoCliente } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.cliente(clienteId),
    queryFn: () => clientesContabilidadeService.detalhe(clienteId),
  });

  const { data: historicoCadastro } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.clienteHistorico(clienteId),
    queryFn: () => clientesContabilidadeService.historico(clienteId),
    enabled: cliente?.modoCobranca === 'fixo',
  });

  const { data: faturamentos, isLoading: carregandoFaturamentos } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.clienteFaturamentos(clienteId),
    queryFn: () => clientesContabilidadeService.listarFaturamentos(clienteId),
    enabled: cliente?.modoCobranca === 'faixa_faturamento',
  });

  const { data: execucoes, isLoading: carregandoExecucoes } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.clienteExecucoes(clienteId),
    queryFn: () => clientesContabilidadeService.execucoes(clienteId),
  });

  const atualizar = useMutation({
    mutationFn: (p: AtualizarClienteContabilidadePayload) => clientesContabilidadeService.atualizar(clienteId, p),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clientes() });
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.cliente(clienteId) });
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clienteHistorico(clienteId) });
      setEditando(false);
      setErro(null);
      toast(`Alterações de ${c.nome} salvas`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  if (carregandoCliente) return <p className="text-sm text-cc-muted">Carregando…</p>;
  if (!cliente) return <p className="alert-error">Cliente contábil não encontrado.</p>;

  const reajustePendente =
    cliente.modoCobranca === 'fixo' &&
    !!historicoCadastro &&
    reajusteAnualPendente(historicoCadastro, cliente.createdAt, new Date());

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{cliente.nome}</h1>
        <Link href="/clientes-contabilidade" className="btn-ghost btn btn-sm">
          Voltar
        </Link>
      </div>

      {/* Barra de ações em destaque, logo abaixo do título — nunca atrás de um formulário. */}
      <div className="flex flex-wrap gap-4">
        <Link href={`/clientes-contabilidade/${clienteId}/execucao`} className="link-action">
          Emissão
        </Link>
        {cliente.modoCobranca === 'faixa_faturamento' && (
          <Link href={`/clientes-contabilidade/${clienteId}/faturamento`} className="link-action">
            Faturamento
          </Link>
        )}
        <button type="button" onClick={() => setEditando((v) => !v)} className="link-action">
          {editando ? 'Cancelar edição' : 'Editar cadastro'}
        </button>
        <Link href={`/clientes-contabilidade/${clienteId}/historico`} className="link-action">
          Histórico
        </Link>
      </div>

      {erro && <p role="alert" className="alert-error">{erro}</p>}

      {editando ? (
        <div className="card p-6">
          <ClienteContabilidadeForm
            inicial={cliente}
            exigeMotivo
            salvando={atualizar.isPending}
            onSubmit={(dados, motivo) => atualizar.mutate({ ...dados, motivo })}
          />
        </div>
      ) : (
        <div className="card grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
          <Info label="Regime tributário" valor={cliente.regimeTributario === 'lucro_presumido' ? 'Lucro Presumido' : 'Simples Nacional'} />
          <Info label="Modo de cobrança" valor={cliente.modoCobranca === 'fixo' ? 'Valor fixo' : 'Faixa de faturamento'} />
          <Info label="Status" valor={cliente.ativo ? 'Ativo' : 'Inativo'} />
        </div>
      )}

      {reajustePendente && (
        <p className="alert-error" role="alert">
          Reajuste anual pendente — a regra de preço deste cliente não é alterada há 12 meses ou
          mais. Confira o índice de reajuste do ano e atualize o valor fixo no cadastro.
        </p>
      )}

      {cliente.modoCobranca === 'faixa_faturamento' && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-cc-ink">Faturamento mensal informado</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cc-hairline text-left text-cc-muted">
                  <th className="py-2.5 px-4 font-medium">Competência</th>
                  <th className="py-2.5 px-4 font-medium">Faturamento</th>
                </tr>
              </thead>
              <tbody>
                {carregandoFaturamentos ? (
                  <tr><td colSpan={2} className="py-4 px-4 text-cc-muted">Carregando…</td></tr>
                ) : !faturamentos || faturamentos.length === 0 ? (
                  <tr><td colSpan={2} className="py-4 px-4 text-cc-muted">Nenhum faturamento lançado ainda.</td></tr>
                ) : (
                  faturamentos.map((f) => (
                    <tr key={f.id} className="border-b border-cc-hairline last:border-0">
                      <td className="py-2.5 px-4 font-medium text-cc-ink">{f.competencia}</td>
                      <td className="py-2.5 px-4 text-cc-ink-2 tabular">R$ {f.faturamento.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-cc-ink">Execuções e boletos emitidos</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cc-hairline text-left text-cc-muted">
                <th className="py-2.5 px-4 font-medium">Competência</th>
                <th className="py-2.5 px-4 font-medium">Tipo</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {carregandoExecucoes ? (
                <tr><td colSpan={4} className="py-4 px-4 text-cc-muted">Carregando…</td></tr>
              ) : !execucoes || execucoes.length === 0 ? (
                <tr><td colSpan={4} className="py-4 px-4 text-cc-muted">Nenhuma execução gerada ainda.</td></tr>
              ) : (
                execucoes.map((e) => (
                  <tr key={e.execucaoId} className="border-b border-cc-hairline last:border-0">
                    <td className="py-2.5 px-4 font-medium text-cc-ink">{e.competencia}</td>
                    <td className="py-2.5 px-4 text-cc-ink-2">
                      <span className="badge-slate">{e.ehAdicional ? 'Adicional semestral' : 'Mensal'}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={e.statusResultado === 'ok' ? 'badge-green' : 'badge-slate'}>{e.statusResultado}</span>
                    </td>
                    <td className="py-2.5 px-4 text-cc-ink-2 tabular">R$ {(e.totalValor ?? 0).toFixed(2)}</td>
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

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="field-label mb-1">{label}</p>
      <p className="text-sm text-cc-ink">{valor}</p>
    </div>
  );
}
