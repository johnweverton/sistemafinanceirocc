import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { medicosService, queryKeys, type SyncRelatorio, type SyncCandidata, type SyncPendenciaSugestao } from '@/services/medicos';
import { ApiClientError } from '@/lib/api-client';
import type { ClienteExterno } from '@cobranca/shared';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface SyncModalProps {
  relatorio: SyncRelatorio;
  onClose: () => void;
}

export function SyncModal({ relatorio, onClose }: SyncModalProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  
  // Arrays mutáveis em memória para remover os itens já resolvidos sem precisar refetch na API
  const [comSugestao, setComSugestao] = useState(relatorio.comSugestao);
  const [semPar, setSemPar] = useState(relatorio.semPar);
  const [vinculados, setVinculados] = useState(relatorio.jaVinculados);
  const [criados, setCriados] = useState(0);

  // Confirmações (tom neutro: são permanentes, mas não destrutivas — não usam o ConfirmDialog
  // vermelho de exclusão).
  const [confirmVinculo, setConfirmVinculo] = useState<{
    medicoId: string;
    externalId: string;
    medicoNome: string;
    clienteNome: string;
  } | null>(null);
  const [confirmCriarTodos, setConfirmCriarTodos] = useState(false);

  const vincular = useMutation({
    mutationFn: (p: { medicoId: string; externalId: string }) => medicosService.vincularExterno(p),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setComSugestao(prev => prev.filter(p => p.cliente.id !== vars.externalId));
      setVinculados(prev => prev + 1);
      setConfirmVinculo(null);
      toast('Médico vinculado com sucesso', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao vincular';
      toast(msg, 'error');
    },
  });

  const criar = useMutation({
    mutationFn: (p: { externalId: string }) => medicosService.criarExterno(p),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setSemPar(prev => prev.filter(c => c.id !== vars.externalId));
      setCriados(prev => prev + 1);
      toast('Novo médico criado com sucesso', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao criar';
      toast(msg, 'error');
    },
  });

  const criarTodos = useMutation({
    mutationFn: (externalIds: string[]) => medicosService.criarTodosExternos({ externalIds }),
    onSuccess: (resultado) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      const idsIgnorados = new Set(resultado.ignorados.map(i => i.externalId));
      setSemPar(prev => prev.filter(c => idsIgnorados.has(c.id)));
      setCriados(prev => prev + resultado.criados);
      setConfirmCriarTodos(false);
      if (resultado.ignorados.length > 0) {
        toast(`${resultado.criados} médicos criados; ${resultado.ignorados.length} não puderam ser criados`, 'error');
      } else {
        toast(`${resultado.criados} médicos criados com sucesso`, 'success');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao criar em lote';
      toast(msg, 'error');
    },
  });

  const isPending = vincular.isPending || criar.isPending || criarTodos.isPending;

  function rejeitarSugestao(pendencia: SyncPendenciaSugestao) {
    setComSugestao(prev => prev.filter(p => p.cliente.id !== pendencia.cliente.id));
    setSemPar(prev => [pendencia.cliente, ...prev]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-cc-surface card flex h-full max-h-[85vh] w-full max-w-4xl flex-col shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cc-hairline px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-cc-ink">Sincronização com o Sistema Web</h2>
            <p className="text-sm text-cc-muted">
              {relatorio.totalOrigem} clientes encontrados na origem. 
              {vinculados > 0 && ` ${vinculados} já vinculados.`} 
              {criados > 0 && ` ${criados} novos criados.`}
            </p>
          </div>
          <button onClick={onClose} disabled={isPending} className="btn-ghost btn btn-sm">
            Fechar
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
          
          {/* Sessão Sugestões */}
          {comSugestao.length > 0 && (
            <section>
              <h3 className="mb-4 text-lg font-semibold text-cc-ink">
                Sugestões de vínculo ({comSugestao.length})
              </h3>
              <div className="space-y-4">
                {comSugestao.map((pend) => (
                  <div key={pend.cliente.id} className="rounded-lg border border-cc-hairline p-4">
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-cc-muted">Origem</span>
                        <p className="font-medium text-cc-ink">{pend.cliente.nome}</p>
                        <p className="text-xs text-cc-ink-2">{pend.cliente.productionType}</p>
                      </div>
                      <button
                        onClick={() => rejeitarSugestao(pend)}
                        disabled={isPending}
                        className="btn-ghost btn btn-sm text-cc-danger"
                      >
                        Nenhum corresponde (Mover para s/ par)
                      </button>
                    </div>

                    <div className="space-y-2 pl-4 border-l-2 border-cc-border">
                      <span className="text-xs font-semibold uppercase tracking-wider text-cc-muted">Possíveis pares locais</span>
                      {pend.candidatas.map(cand => (
                        <div key={cand.medicoId} className="flex items-center justify-between rounded bg-cc-surface-2 p-2">
                          <div>
                            <p className="font-medium text-cc-ink">{cand.nome}</p>
                            {cand.viaCpf ? (
                              <p className="text-xs font-semibold text-cc-success">CPF idêntico — mesma pessoa</p>
                            ) : (
                              <p className="text-xs text-cc-muted">Score de similaridade: {(cand.score * 100).toFixed(0)}%</p>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              setConfirmVinculo({
                                medicoId: cand.medicoId,
                                externalId: pend.cliente.id,
                                medicoNome: cand.nome,
                                clienteNome: pend.cliente.nome,
                              })
                            }
                            disabled={isPending}
                            className="btn-primary btn btn-sm"
                          >
                            Confirmar vínculo
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Sessão Sem Par */}
          {semPar.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-cc-ink">
                  Sem par local - Criar novos ({semPar.length})
                </h3>
                <button
                  onClick={() => setConfirmCriarTodos(true)}
                  disabled={isPending}
                  className="btn-primary btn btn-sm"
                >
                  {criarTodos.isPending ? 'Criando...' : `Criar todos (${semPar.length})`}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {semPar.map((cli) => (
                  <div key={cli.id} className="flex flex-col justify-between rounded-lg border border-cc-hairline p-4">
                    <div className="mb-3">
                      <p className="font-medium text-cc-ink">{cli.nome}</p>
                      <p className="text-xs text-cc-ink-2">{cli.productionType}</p>
                    </div>
                    <button
                      onClick={() => criar.mutate({ externalId: cli.id })}
                      disabled={isPending}
                      className="btn-secondary btn btn-sm w-full"
                    >
                      Criar médico novo
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Sessão Não sincronizáveis */}
          {relatorio.naoSincronizaveis.length > 0 && (
            <section>
              <h3 className="mb-4 text-lg font-semibold text-cc-ink">
                Não sincronizáveis / Ignorados ({relatorio.naoSincronizaveis.length})
              </h3>
              <ul className="list-disc pl-5 text-sm text-cc-ink-2 space-y-1">
                {relatorio.naoSincronizaveis.map((nao) => (
                  <li key={nao.cliente.id}>
                    <strong>{nao.cliente.nome}</strong>: {nao.motivo}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {comSugestao.length === 0 && semPar.length === 0 && (
            <div className="py-12 text-center text-cc-ink-2">
              <p className="text-lg font-medium">Tudo sincronizado!</p>
              <p className="text-sm">Não há mais pendências de vínculo.</p>
            </div>
          )}

        </div>
      </div>

      {confirmVinculo && (
        <ConfirmDialog
          tone="neutral"
          titulo="Confirmar vínculo"
          mensagem={`Vincular "${confirmVinculo.clienteNome}" (origem) a "${confirmVinculo.medicoNome}" (local)? Atenção: o vínculo é PERMANENTE.`}
          confirmLabel="Confirmar vínculo"
          confirmandoLabel="Vinculando..."
          confirmando={vincular.isPending}
          onCancel={() => setConfirmVinculo(null)}
          onConfirm={() =>
            vincular.mutate({ medicoId: confirmVinculo.medicoId, externalId: confirmVinculo.externalId })
          }
        />
      )}

      {confirmCriarTodos && (
        <ConfirmDialog
          tone="neutral"
          titulo="Criar médicos em lote"
          mensagem={`Criar os ${semPar.length} médicos de uma vez? Eles entram como "necessita configuração" até o cadastro ser completado.`}
          confirmLabel={`Criar todos (${semPar.length})`}
          confirmandoLabel="Criando..."
          confirmando={criarTodos.isPending}
          onCancel={() => setConfirmCriarTodos(false)}
          onConfirm={() => criarTodos.mutate(semPar.map(c => c.id))}
        />
      )}
    </div>
  );
}
