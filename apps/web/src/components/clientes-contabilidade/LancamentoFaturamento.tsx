'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import {
  clientesContabilidadeService,
  clienteContabilidadeQueryKeys,
} from '@/services/clientes-contabilidade';
import { useToast } from '@/components/ui/Toast';

function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

export function LancamentoFaturamento({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [faturamento, setFaturamento] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const { data: cliente } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.cliente(clienteId),
    queryFn: () => clientesContabilidadeService.detalhe(clienteId),
  });

  const { data: faturamentos, isLoading } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.clienteFaturamentos(clienteId),
    queryFn: () => clientesContabilidadeService.listarFaturamentos(clienteId),
  });

  const lancar = useMutation({
    mutationFn: () =>
      clientesContabilidadeService.lancarFaturamento(clienteId, {
        competencia,
        faturamento: Number(faturamento),
      }),
    onSuccess: (resp) => {
      void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.clienteFaturamentos(clienteId) });
      setErro(null);
      if (resp.preview.alertas.length > 0) {
        toast(resp.preview.alertas[0] ?? 'Faturamento lançado com alerta na regra de preço', 'error');
      } else {
        toast(`Faturamento lançado. Boleto calculado: R$ ${resp.preview.valor.toFixed(2)}`, 'success');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao lançar faturamento';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const faturamentoNum = faturamento === '' ? null : Number(faturamento);
  const podeEnviar = /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) && faturamentoNum != null && faturamentoNum >= 0;

  if (cliente && cliente.modoCobranca !== 'faixa_faturamento') {
    return (
      <p className="text-sm text-cc-muted">
        Este cliente está no modo de cobrança &ldquo;valor fixo&rdquo;, que não usa lançamento de
        faturamento mensal.
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lançar faturamento</h1>
          {cliente && <p className="mt-0.5 text-sm text-cc-ink-2">{cliente.nome}</p>}
        </div>
        <Link href="/clientes-contabilidade" className="btn-ghost btn btn-sm">
          Voltar
        </Link>
      </div>

      {erro && <p role="alert" className="alert-error">{erro}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (podeEnviar) lancar.mutate();
        }}
        className="card grid grid-cols-1 gap-4 p-6 sm:grid-cols-3"
      >
        <label className="block">
          <span className="field-label mb-1.5">Competência</span>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="input"
          />
        </label>
        <label className="block">
          <span className="field-label mb-1.5">Faturamento do mês (R$)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={faturamento}
            onChange={(e) => setFaturamento(e.target.value)}
            className="input tabular"
            placeholder="0.00"
          />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={!podeEnviar || lancar.isPending} className="btn-primary">
            {lancar.isPending ? 'Calculando...' : 'Lançar e calcular boleto'}
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-cc-hairline text-left text-cc-muted">
              <th className="py-2.5 px-4 font-medium">Competência</th>
              <th className="py-2.5 px-4 font-medium">Faturamento informado</th>
              <th className="py-2.5 px-4 font-medium">Lançado em</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={3} className="py-4 px-4 text-cc-muted">Carregando…</td>
              </tr>
            ) : !faturamentos || faturamentos.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-4 px-4 text-cc-muted">Nenhum faturamento lançado ainda.</td>
              </tr>
            ) : (
              faturamentos.map((f) => (
                <tr key={f.id} className="border-b border-cc-hairline last:border-0">
                  <td className="py-2.5 px-4 font-medium text-cc-ink">{f.competencia}</td>
                  <td className="py-2.5 px-4 text-cc-ink-2 tabular">R$ {f.faturamento.toFixed(2)}</td>
                  <td className="py-2.5 px-4 text-cc-ink-2">{new Date(f.informadoEm).toLocaleString('pt-BR')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
