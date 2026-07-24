'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { clientesContabilidadeService, clienteContabilidadeQueryKeys } from '@/services/clientes-contabilidade';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { boletosService } from '@/services/boletos';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';
import { useToast } from '@/components/ui/Toast';

function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

export function GerarExecucao({ clienteId }: { clienteId: string }) {
  const { toast } = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [execucaoId, setExecucaoId] = useState<string | null>(null);

  const { data: cliente } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.cliente(clienteId),
    queryFn: () => clientesContabilidadeService.detalhe(clienteId),
  });

  const disparar = useMutation({
    mutationFn: () => execucoesService.disparar(competencia, [], undefined, clienteId),
    onSuccess: (r) => setExecucaoId(r.execucaoId),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao gerar execução', 'error'),
  });

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Gerar execução{cliente ? ` — ${cliente.nome}` : ''}</h1>
        <Link href="/clientes-contabilidade" className="btn-ghost btn btn-sm">
          Voltar
        </Link>
      </div>

      {!execucaoId && (
        <div className="card grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
          <label className="block">
            <span className="field-label mb-1.5">Competência</span>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="input"
            />
          </label>
          <div className="flex items-end">
            <button
              onClick={() => disparar.mutate()}
              disabled={disparar.isPending || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)}
              className="btn-primary"
            >
              {disparar.isPending ? 'Gerando...' : 'Gerar execução'}
            </button>
          </div>
        </div>
      )}

      {execucaoId && <Acompanhamento execucaoId={execucaoId} />}
    </section>
  );
}

function Acompanhamento({ execucaoId }: { execucaoId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { execucao } = useExecucaoRealtime(execucaoId);

  const { data: resultados } = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId),
    queryFn: () => execucoesService.resultados(execucaoId),
    enabled: execucao?.status === 'concluido',
  });
  const resultado = resultados?.[0];

  const emitir = useMutation({
    mutationFn: () => boletosService.emitir(resultado!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) });
      toast('Boleto emitido com sucesso', 'success');
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao emitir boleto', 'error'),
  });

  return (
    <div className="card space-y-4 p-6">
      {execucao?.status === 'processando' && <p className="text-sm text-cc-muted">Processando…</p>}
      {execucao?.status === 'erro' && <p className="alert-error">Falha ao processar a execução.</p>}

      {execucao?.status === 'concluido' && resultado && (
        <div className="space-y-3">
          <p className="text-sm text-cc-ink-2">
            Status: <span className={resultado.status === 'ok' ? 'badge-green' : 'badge-slate'}>{resultado.status}</span>
          </p>
          <p className="text-lg font-semibold text-cc-ink tabular">
            Valor calculado: R$ {(resultado.totalValor ?? 0).toFixed(2)}
          </p>
          {resultado.alertas.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-cc-danger">
              {resultado.alertas.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {resultado.status === 'ok' && (
            <button onClick={() => emitir.mutate()} disabled={emitir.isPending} className="btn-primary">
              {emitir.isPending ? 'Emitindo...' : 'Emitir boleto'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
