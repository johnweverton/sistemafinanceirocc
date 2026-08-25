'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import { lotesEmissaoService, type PreviewLoteEmissao } from '@/services/boletos-lote';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const CODIGO_ERRO_LABEL: Record<string, string> = {
  COBRANCA_INCOMPLETA: 'Cadastro de cobrança incompleto',
  VALOR_ABAIXO_MINIMO: 'Valor abaixo do mínimo do gateway (R$ 5,00)',
  CONTA_NAO_CONFIGURADA: 'Conta emissora sem credenciais configuradas',
  BOLETO_JA_EMITIDO: 'Já tinha boleto emitido',
  SEM_MEDICO: 'Sem médico/empresa/cliente vinculado',
  STATUS_INVALIDO: 'Status do resultado não é mais "ok"',
};

/**
 * Fluxo de emissão em lote (revisão de arquitetura 2026-07-31, decisão 5): abre já disparando o
 * preview (síncrono, só leitura — sem efeito externo). O operador confirma UMA vez; o
 * processamento depois é assíncrono e acompanhado por polling. Fechar o diálogo não cancela um
 * lote já confirmado — ele continua rodando no servidor.
 */
export function LoteEmissaoDialog({
  execucaoId,
  onClose,
  onAlgumEmitido,
  tituloPrefixo,
  onVoltar,
}: {
  execucaoId: string;
  onClose: () => void;
  /** Chamado quando o lote conclui — o chamador invalida a lista de resultados. */
  onAlgumEmitido: () => void;
  /**
   * Breadcrumb do modal-dentro-de-modal (G-39): quando este diálogo substitui outro no mesmo
   * lugar, o chamador passa o contexto de origem (ex.: "Lote 2026-08") e o título vira
   * "Lote 2026-08 · Emitir boletos", deixando explícito que é o mesmo lote.
   */
  tituloPrefixo?: string;
  /** Volta para o diálogo de origem (não fecha o fluxo). Renderiza "← Voltar ao lote". */
  onVoltar?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [loteId, setLoteId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewLoteEmissao | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  const montarPreview = useMutation({
    mutationFn: () => lotesEmissaoService.criarPreview(execucaoId),
    onSuccess: (data) => {
      setLoteId(data.lote.id);
      setPreview(data);
    },
    onError: (e) => {
      toast(e instanceof ApiClientError ? e.message : 'Erro ao montar o preview do lote', 'error');
      onClose();
    },
  });

  // Dispara o preview uma única vez, ao abrir o diálogo.
  useEffect(() => {
    montarPreview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmar = useMutation({
    mutationFn: () =>
      lotesEmissaoService.confirmar(loteId!, {
        totalItens: preview!.lote.snapshotTotalItens,
        totalValor: preview!.lote.snapshotTotalValor,
      }),
    onSuccess: () => {
      setConfirmado(true);
      toast('Lote confirmado. Emitindo em segundo plano…', 'success');
    },
    onError: (e) => {
      if (e instanceof ApiClientError && (e.code === 'SNAPSHOT_DIVERGENTE' || e.code === 'LOTE_EXPIRADO')) {
        toast(`${e.message} Gerando um preview novo…`, 'info');
        setLoteId(null);
        setPreview(null);
        montarPreview.mutate();
        return;
      }
      toast(e instanceof ApiClientError ? e.message : 'Erro ao confirmar o lote', 'error');
    },
  });

  const retomar = useMutation({
    mutationFn: () => lotesEmissaoService.retomar(loteId!),
    onSuccess: () => toast('Lote retomado', 'success'),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao retomar o lote', 'error'),
  });

  const acompanhar = useQuery({
    queryKey: ['lote-emissao', loteId],
    queryFn: () => lotesEmissaoService.status(loteId!),
    enabled: !!loteId && (confirmado || retomar.isSuccess),
    refetchInterval: (query) => (query.state.data?.lote.status === 'processando' ? 2000 : false),
  });

  const statusAtual = acompanhar.data?.lote.status;
  useEffect(() => {
    if (statusAtual === 'concluido') {
      onAlgumEmitido();
      void qc.invalidateQueries({ queryKey: ['lote-emissao', loteId] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusAtual]);

  return (
    <Modal
      titulo={tituloPrefixo ? `${tituloPrefixo} · Emitir boletos` : 'Emitir boletos em lote'}
      largura="lg"
      onClose={onClose}
      // "Em voo" aqui é a REQUISIÇÃO de confirmar/retomar, não o lote processando: o lote
      // confirmado roda no servidor e o diálogo é explicitamente fechável durante o
      // acompanhamento (decisão 5 da revisão de arquitetura 2026-07-31, botão "Fechar" ativo).
      emVoo={confirmar.isPending || retomar.isPending}
      mensagemEmVoo="Aguarde a confirmação do lote terminar."
      corpoClassName="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4"
      rodape={
        <>
          {onVoltar && (
            <button onClick={onVoltar} className="btn-ghost btn btn-sm">
              ← Voltar ao lote
            </button>
          )}
          <button onClick={onClose} className="btn-ghost btn btn-sm">
            {confirmado || retomar.isSuccess ? 'Fechar' : 'Cancelar'}
          </button>
          {preview && !confirmado && !retomar.isSuccess && (
            <button
              onClick={() => confirmar.mutate()}
              disabled={confirmar.isPending || preview.lote.snapshotTotalItens === 0}
              className="btn-primary btn btn-sm"
            >
              {confirmar.isPending ? 'Confirmando…' : `Confirmar emissão de ${preview.lote.snapshotTotalItens}`}
            </button>
          )}
        </>
      }
    >
      {montarPreview.isPending && <p className="text-sm text-cc-muted">Montando o preview…</p>}

      {preview && !confirmado && !retomar.isSuccess && <PreviewConteudo preview={preview} />}

      {(confirmado || retomar.isSuccess) && (
        <AcompanhamentoConteudo
          carregando={acompanhar.isLoading}
          status={statusAtual}
          lote={acompanhar.data?.lote}
          onRetomar={() => retomar.mutate()}
          retomando={retomar.isPending}
        />
      )}
    </Modal>
  );
}

function PreviewConteudo({ preview }: { preview: PreviewLoteEmissao }) {
  const pulados = preview.itens.filter((i) => i.status === 'pulado');
  const aceitos = preview.itens.filter((i) => i.status === 'pendente');

  return (
    <>
      <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-4 py-3">
        <p className="text-sm text-cc-ink">
          <strong>{aceitos.length}</strong> boleto{aceitos.length !== 1 ? 's' : ''} ser
          {aceitos.length !== 1 ? 'ão' : 'á'} emitido{aceitos.length !== 1 ? 's' : ''}, totalizando{' '}
          <strong>{brl(preview.lote.snapshotTotalValor)}</strong>.
        </p>
      </div>

      {preview.porContaEmissora.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-cc-muted">Por conta emissora</p>
          <table className="w-full text-sm">
            <tbody>
              {preview.porContaEmissora.map((c) => (
                <tr key={c.contaEmissora} className="border-t border-cc-hairline">
                  <td className="py-1.5 text-cc-ink-2">{CONTA_EMISSORA_LABEL[c.contaEmissora]}</td>
                  <td className="py-1.5 text-right text-cc-ink-2">{c.itens} boleto{c.itens !== 1 ? 's' : ''}</td>
                  <td className="py-1.5 text-right tabular font-medium text-cc-ink">{brl(c.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pulados.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-cc-muted">
            {pulados.length} não ser{pulados.length !== 1 ? 'ão' : 'á'} emitido{pulados.length !== 1 ? 's' : ''}
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto rounded border border-cc-hairline bg-cc-surface-2 p-3 text-xs text-cc-ink-2">
            {pulados.map((i) => (
              <li key={i.id}>
                <strong>{i.nome}</strong>: {i.codigoErro ? (CODIGO_ERRO_LABEL[i.codigoErro] ?? i.codigoErro) : 'motivo desconhecido'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {aceitos.length === 0 && (
        <p className="text-sm text-cc-warning">Nenhum item elegível. Não é possível confirmar este lote.</p>
      )}
    </>
  );
}

function AcompanhamentoConteudo({
  carregando,
  status,
  lote,
  onRetomar,
  retomando,
}: {
  carregando: boolean;
  status?: string;
  lote?: { progresso: number; totalEmitidos: number; totalPulados: number; totalFalhas: number; totalValorEmitido: number; motivoPausa: string | null };
  onRetomar: () => void;
  retomando: boolean;
}) {
  if (carregando || !lote) return <p className="text-sm text-cc-muted">Carregando status…</p>;

  return (
    <div className="space-y-3">
      <div className="h-2 w-full overflow-hidden rounded-full bg-cc-surface-2">
        <div
          className={`h-full rounded-full transition-all ${status === 'pausado_por_falhas' ? 'bg-cc-warning' : 'bg-cc-accent'}`}
          style={{ width: `${lote.progresso}%` }}
        />
      </div>
      <p className="text-sm text-cc-ink-2">
        {status === 'processando' && `Processando… ${lote.progresso}%`}
        {status === 'concluido' && 'Lote concluído.'}
        {status === 'pausado_por_falhas' && 'Lote pausado.'}
      </p>

      {status === 'pausado_por_falhas' && lote.motivoPausa && (
        <div className="rounded-lg border border-cc-warning/40 bg-cc-warning-soft px-4 py-3 text-sm text-cc-ink">
          <p className="font-medium">Motivo: {lote.motivoPausa}</p>
          <p className="mt-1 text-xs text-cc-muted">
            Corrija o problema (ex.: credenciais da conta) e retome. Só os itens ainda pendentes serão reprocessados.
          </p>
          <button onClick={onRetomar} disabled={retomando} className="btn-primary btn btn-sm mt-3">
            {retomando ? 'Retomando…' : 'Retomar lote'}
          </button>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-lg border border-cc-hairline p-2">
          <dt className="text-2xs uppercase tracking-wide text-cc-muted">Emitidos</dt>
          <dd className="tabular font-semibold text-cc-success">{lote.totalEmitidos}</dd>
        </div>
        <div className="rounded-lg border border-cc-hairline p-2">
          <dt className="text-2xs uppercase tracking-wide text-cc-muted">Pulados</dt>
          <dd className="tabular font-semibold text-cc-ink">{lote.totalPulados}</dd>
        </div>
        <div className="rounded-lg border border-cc-hairline p-2">
          <dt className="text-2xs uppercase tracking-wide text-cc-muted">Falhas</dt>
          <dd className="tabular font-semibold text-cc-danger">{lote.totalFalhas}</dd>
        </div>
      </dl>

      {status === 'concluido' && (
        <p className="text-sm text-cc-ink">
          Valor efetivamente emitido: <strong>{brl(lote.totalValorEmitido)}</strong>
        </p>
      )}
    </div>
  );
}
