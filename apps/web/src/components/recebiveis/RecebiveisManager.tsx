'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContaEmissora, FiltroRecebiveis, Recebivel, StatusRecebivel } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL, CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';
import { recebiveisService, recebiveisQueryKeys } from '@/services/recebiveis';
import { boletosService } from '@/services/boletos';
import { ApiClientError } from '@/lib/api-client';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DisparoBadges } from '@/components/boletos/DisparoBadges';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { brl } from '@/lib/formato';

/** Formata timestamp ISO como data e hora locais compactas (dd/mm/aa hh:mm). */
function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: StatusRecebivel }) {
  if (status === 'pago') return <span className="badge-green">Pago</span>;
  if (status === 'vencido') return <span className="badge-amber">Vencido</span>;
  if (status === 'cancelado') return <span className="badge-red">Cancelado</span>;
  return <span className="badge-slate">Em aberto</span>;
}

const STATUS_OPCOES: { valor: StatusRecebivel | ''; label: string }[] = [
  { valor: '', label: 'Todos os status' },
  { valor: 'em_aberto', label: 'Em aberto' },
  { valor: 'vencido', label: 'Vencido' },
  { valor: 'pago', label: 'Pago' },
  { valor: 'cancelado', label: 'Cancelado' },
];

// Filtro por empresa emissora — rótulos da fonte única do shared.
const CONTA_OPCOES: { valor: ContaEmissora | ''; label: string }[] = [
  { valor: '', label: 'Todas as empresas' },
  ...CONTAS_EMISSORAS_VALIDAS.map((c) => ({ valor: c, label: CONTA_EMISSORA_LABEL[c] })),
];

const MOTIVO_MIN = 5;

/**
 * Diálogo de cancelamento com motivo obrigatório. Não reusa ConfirmDialog porque o
 * cancelamento exige entrada de texto (trilha de auditoria), não só confirmação.
 */
function CancelarBoletoDialog({
  recebivel,
  confirmando,
  onConfirm,
  onCancel,
}: {
  recebivel: Recebivel;
  confirmando: boolean;
  onConfirm: (motivo: string) => void;
  onCancel: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const motivoValido = motivo.trim().length >= MOTIVO_MIN;

  return (
    <Modal
      titulo="Cancelar boleto"
      largura="md"
      onClose={onCancel}
      // Cancelamento em voo: a chamada já saiu para a Cora — Escape/backdrop não podem sumir com
      // a tela e deixar o operador sem saber se o boleto foi cancelado ou não.
      emVoo={confirmando}
      mensagemEmVoo="Aguarde o cancelamento terminar."
      rodape={
        <>
          <button onClick={onCancel} disabled={confirmando} className="btn-ghost btn btn-sm">
            Voltar
          </button>
          <button
            onClick={() => onConfirm(motivo.trim())}
            disabled={confirmando || !motivoValido}
            className="btn-danger btn btn-sm"
            title={motivoValido ? undefined : `Informe o motivo (mínimo ${MOTIVO_MIN} caracteres)`}
          >
            {confirmando ? 'Cancelando...' : 'Cancelar boleto'}
          </button>
        </>
      }
    >
      <p className="text-sm text-cc-ink-2">
        Cancelar o boleto de <strong>{recebivel.nome}</strong> ({recebivel.competencia}) no valor de{' '}
        <strong>{brl(recebivel.valor)}</strong>? Após o cancelamento, um novo boleto poderá ser
        emitido para este resultado.
      </p>
      <label className="block text-xs font-medium text-cc-ink-2" htmlFor="motivo-cancelamento">
        Motivo do cancelamento (obrigatório)
      </label>
      <textarea
        id="motivo-cancelamento"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: valor incorreto, será reemitido com o valor certo"
        className="input min-h-20 w-full"
        maxLength={500}
        disabled={confirmando}
      />
      <p className="text-xs font-semibold text-cc-danger">
        O boleto será cancelado na Cora. Esta ação NÃO PODE ser desfeita.
      </p>
    </Modal>
  );
}

export function RecebiveisManager() {
  const [competencia, setCompetencia] = useState('');
  const [status, setStatus] = useState<StatusRecebivel | ''>('');
  const [conta, setConta] = useState<ContaEmissora | ''>('');
  const [cancelando, setCancelando] = useState<Recebivel | null>(null);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Abre o PDF do boleto em nova aba (URL pública da Cora) — permite conferir o boleto e
  // reenviar manualmente quando o disparo automático falhar.
  async function baixarBoleto(boletoId: string) {
    setBaixandoId(boletoId);
    try {
      const { url } = await boletosService.pdf(boletoId);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast(
        e instanceof ApiClientError ? e.message : 'Erro ao obter o PDF do boleto',
        'error',
      );
    } finally {
      setBaixandoId(null);
    }
  }

  const filtros: FiltroRecebiveis = {
    competencia: competencia || undefined,
    statusDerivado: status || undefined,
    contaEmissora: conta || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: recebiveisQueryKeys.recebiveis(filtros),
    queryFn: () => recebiveisService.listar(filtros),
  });

  const cancelar = useMutation({
    mutationFn: ({ boletoId, motivo }: { boletoId: string; motivo: string }) =>
      boletosService.cancelar(boletoId, motivo),
    onSuccess: () => {
      toast('Boleto cancelado. Um novo pode ser emitido para o resultado', 'success');
      setCancelando(null);
      void qc.invalidateQueries({ queryKey: ['recebiveis'] });
    },
    onError: (e) => {
      if (e instanceof ApiClientError) {
        if (e.code === 'BOLETO_PAGO') {
          // Pagamento chegou entre a tela e o clique — a rota já sincronizou a baixa.
          toast('Este boleto foi pago na Cora. A baixa foi sincronizada, não é possível cancelar.', 'info');
          setCancelando(null);
          void qc.invalidateQueries({ queryKey: ['recebiveis'] });
          return;
        }
        if (e.code === 'BOLETO_JA_CANCELADO') {
          toast('Este boleto já estava cancelado.', 'info');
          setCancelando(null);
          void qc.invalidateQueries({ queryKey: ['recebiveis'] });
          return;
        }
        toast(e.message, 'error');
        return;
      }
      toast('Erro ao cancelar boleto', 'error');
    },
  });

  const recebiveis = data ?? [];

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Contas a Receber</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            placeholder="Competência (AAAA-MM)"
            className="input font-mono w-40"
            maxLength={7}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusRecebivel | '')} className="input w-44">
            {STATUS_OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>
          <select
            value={conta}
            onChange={(e) => setConta(e.target.value as ContaEmissora | '')}
            className="input w-44"
            aria-label="Filtrar por empresa emissora"
          >
            {CONTA_OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={11} />
      ) : recebiveis.length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
            </svg>
          }
          title="Nenhum recebível encontrado"
          description="Boletos emitidos aparecem aqui com o status de pagamento. Ajuste os filtros ou emita boletos."
        />
      ) : (
        <div className="card overflow-hidden">
          {/* Scroll horizontal: com 11 colunas a tabela estoura a largura no celular —
              o container arrasta pro lado e nada (nem o botão do PDF) fica cortado. */}
          <div className="overflow-x-auto">
            <table className="data-table whitespace-nowrap">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Médico</th>
                <th>Empresa</th>
                <th>Competência</th>
                <th className="text-right">Valor</th>
                <th>Emitido em</th>
                <th>Vencimento</th>
                <th>Pago em</th>
                <th>Status</th>
                <th>Envios</th>
                <th className="text-right">Valor pago</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {recebiveis.map((r) => {
                // Valor pago difere do emitido quando houve desconto (pagou antes),
                // multa/juros (pagou depois) ou pagamento parcial — destaca pra revisão.
                const difereValorPago =
                  r.pagoEm != null &&
                  r.valorPago != null &&
                  r.valor != null &&
                  Math.abs(r.valorPago - r.valor) >= 0.01;
                return (
                <tr key={r.boletoId}>
                  <td className="font-medium">{r.nome}</td>
                  <td>
                    <span className="badge-slate" title="Empresa emissora do boleto">
                      {CONTA_EMISSORA_LABEL[r.contaEmissora]}
                    </span>
                  </td>
                  <td className="font-mono tabular text-cc-ink-2">{r.competencia}</td>
                  <td className="text-right tabular font-medium">{brl(r.valor)}</td>
                  <td className="font-mono tabular text-cc-ink-2">{dataHora(r.emitidoEm)}</td>
                  <td className="font-mono tabular text-cc-ink-2">{r.vencimento ?? '—'}</td>
                  <td className="font-mono tabular text-cc-ink-2">{r.pagoEm ? dataHora(r.pagoEm) : '—'}</td>
                  <td><StatusBadge status={r.statusDerivado} /></td>
                  <td>
                    <DisparoBadges disparos={r.disparos} />
                  </td>
                  <td className="text-right tabular">
                    {!r.pagoEm ? (
                      <span className="text-cc-muted">—</span>
                    ) : difereValorPago ? (
                      <span
                        className="font-semibold text-cc-warning"
                        title={`Emitido ${brl(r.valor)} · pago ${brl(r.valorPago)} (${
                          (r.valorPago ?? 0) > (r.valor ?? 0) ? 'a mais' : 'a menos'
                        } ${brl(Math.abs((r.valorPago ?? 0) - (r.valor ?? 0)))})`}
                      >
                        {brl(r.valorPago)}
                      </span>
                    ) : (
                      <span className="text-cc-muted">{brl(r.valorPago)}</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* PDF disponível para qualquer boleto emitido (a rota devolve 404 se não houver). */}
                      <button
                        onClick={() => void baixarBoleto(r.boletoId)}
                        className="btn-ghost btn btn-sm"
                        disabled={baixandoId === r.boletoId}
                        title="Abrir o PDF do boleto em nova aba"
                      >
                        {baixandoId === r.boletoId ? 'Abrindo…' : 'Boleto (PDF)'}
                      </button>
                      {/* Cancelável só em aberto/vencido (boleto 'emitido'); pago/cancelado não têm ação. */}
                      {(r.statusDerivado === 'em_aberto' || r.statusDerivado === 'vencido') && (
                        <button
                          onClick={() => setCancelando(r)}
                          className="btn-ghost btn btn-sm text-cc-danger"
                          disabled={cancelar.isPending}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
            </table>
          </div>
        </div>
      )}

      {cancelando && (
        <CancelarBoletoDialog
          recebivel={cancelando}
          confirmando={cancelar.isPending}
          onConfirm={(motivo) => cancelar.mutate({ boletoId: cancelando.boletoId, motivo })}
          onCancel={() => setCancelando(null)}
        />
      )}
    </section>
  );
}
