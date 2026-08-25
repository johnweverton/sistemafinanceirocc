'use client';
// Relatório de recebíveis agrupado por empresa (conta emissora) — preview + export Excel/PDF +
// gestão do link público do BI. Substitui o processo manual (planilha enviada por e-mail/
// WhatsApp para a CEO): boletos, valor, status de pagamento, data de pagamento, por empresa.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ContaEmissora, TipoServico } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL, CONTAS_EMISSORAS_VALIDAS, TIPO_SERVICO_LABEL, TIPOS_SERVICO_VALIDOS } from '@cobranca/shared';
import { relatoriosService, relatoriosQueryKeys, type FiltroRelatorio } from '@/services/relatorios';
import { ApiClientError } from '@/lib/api-client';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { LinkPublicoBI } from './LinkPublicoBI';
import { brl } from '@/lib/formato';

/** AAAA-MM-DD (ou timestamp ISO) → DD/MM/AAAA. String pura (sem passar por Date) para não
 *  sofrer deslocamento de fuso horário — mesmo padrão de formatarDataBR em gateway/mensagem-boleto.ts. */
function dataBr(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

const STATUS_LABEL: Record<string, string> = {
  pago: 'Pago',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
  em_aberto: 'Em aberto',
};

/** Competência do mês corrente (YYYY-MM), mesmo default usado em /recebiveis e /dashboard. */
function competenciaCorrente(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

export function RelatoriosManager() {
  const [competencia, setCompetencia] = useState(competenciaCorrente());
  const [conta, setConta] = useState<ContaEmissora | ''>('');
  const [tipoServico, setTipoServico] = useState<TipoServico | ''>('');
  const { toast } = useToast();

  const filtro: FiltroRelatorio = {
    competencia: competencia || undefined,
    conta: conta || undefined,
    tipoServico: tipoServico || undefined,
  };

  const relatorioQ = useQuery({
    queryKey: relatoriosQueryKeys.preview(filtro),
    queryFn: () => relatoriosService.preview(filtro),
  });

  function erroToast(e: unknown, fallback: string) {
    toast(e instanceof ApiClientError ? e.message : fallback, 'error');
  }

  const sufixoArquivo = `${competencia || 'todas'}-${conta || 'todas'}-${tipoServico || 'todos'}`;

  const exportarExcel = useMutation({
    mutationFn: () => relatoriosService.exportarExcel(filtro),
    onSuccess: (blob) => {
      baixarBlob(blob, `recebiveis-${sufixoArquivo}.xlsx`);
      toast('Excel gerado.', 'success');
    },
    onError: (e) => erroToast(e, 'Erro ao exportar Excel'),
  });

  const exportarPdf = useMutation({
    mutationFn: () => relatoriosService.exportarPdf(filtro),
    onSuccess: (blob) => {
      baixarBlob(blob, `recebiveis-${sufixoArquivo}.pdf`);
      toast('PDF gerado.', 'success');
    },
    onError: (e) => erroToast(e, 'Erro ao exportar PDF'),
  });

  const relatorio = relatorioQ.data;
  const semDados = !relatorioQ.isLoading && relatorio && relatorio.grupos.length === 0;

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Relatórios</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="input w-40"
            aria-label="Competência"
          />
          <select
            value={conta}
            onChange={(e) => setConta(e.target.value as ContaEmissora | '')}
            className="input w-44"
            aria-label="Empresa"
          >
            <option value="">Todas as empresas</option>
            {CONTAS_EMISSORAS_VALIDAS.map((c) => (
              <option key={c} value={c}>{CONTA_EMISSORA_LABEL[c]}</option>
            ))}
          </select>
          <select
            value={tipoServico}
            onChange={(e) => setTipoServico(e.target.value as TipoServico | '')}
            className="input w-44"
            aria-label="Tipo de serviço"
          >
            <option value="">Todos os serviços</option>
            {TIPOS_SERVICO_VALIDOS.map((t) => (
              <option key={t} value={t}>{TIPO_SERVICO_LABEL[t]}</option>
            ))}
          </select>
          <button
            onClick={() => exportarExcel.mutate()}
            disabled={exportarExcel.isPending}
            className="btn-secondary btn btn-sm"
          >
            {exportarExcel.isPending ? 'Gerando…' : 'Exportar Excel'}
          </button>
          <button
            onClick={() => exportarPdf.mutate()}
            disabled={exportarPdf.isPending}
            className="btn-secondary btn btn-sm"
          >
            {exportarPdf.isPending ? 'Gerando…' : 'Exportar PDF'}
          </button>
        </div>
      </div>

      {relatorioQ.isLoading ? (
        <Skeleton className="h-64" />
      ) : !relatorio ? (
        <EmptyState title="Não foi possível carregar o relatório" description="Tente novamente em instantes." />
      ) : semDados ? (
        <EmptyState title="Sem recebíveis no período" description="Ajuste a competência ou a empresa selecionada." />
      ) : (
        <div className="card space-y-5 p-5">
          {relatorio.grupos.map((grupo) => (
            <div key={grupo.contaEmissora}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-cc-ink">{grupo.contaEmissoraLabel}</h2>
                <span className="tabular text-sm font-semibold text-cc-ink">{brl(grupo.subtotal.totalEmitido)}</span>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="data-table">
                  <thead className="border-b border-cc-hairline bg-cc-surface-2">
                    <tr>
                      <th>Médico/Cliente</th>
                      <th>Vencimento</th>
                      <th className="text-right">Valor</th>
                      <th>Status</th>
                      <th>Pago em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.linhas.map((r) => (
                      <tr key={r.boletoId}>
                        <td>{r.nome}</td>
                        <td>{r.vencimento ? dataBr(r.vencimento) : '—'}</td>
                        <td className="text-right tabular">{brl(r.valor ?? 0)}</td>
                        <td>{STATUS_LABEL[r.statusDerivado] ?? r.statusDerivado}</td>
                        <td>{r.pagoEm ? dataBr(r.pagoEm) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-cc-hairline font-semibold text-cc-ink">
                      <td colSpan={2}>Subtotal {grupo.contaEmissoraLabel}</td>
                      <td className="text-right tabular">{brl(grupo.subtotal.totalEmitido)}</td>
                      <td colSpan={2} className="text-xs font-normal text-cc-muted">
                        Pago {brl(grupo.subtotal.totalPago)} · Em aberto {brl(grupo.subtotal.totalEmAberto)} · Vencido {brl(grupo.subtotal.totalVencido)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between border-t border-cc-hairline pt-3">
            <h2 className="text-base font-bold text-cc-ink">Total geral</h2>
            <span className="tabular text-lg font-bold text-cc-ink">{brl(relatorio.totalGeral.totalEmitido)}</span>
          </div>
        </div>
      )}

      <LinkPublicoBI />
    </section>
  );
}
