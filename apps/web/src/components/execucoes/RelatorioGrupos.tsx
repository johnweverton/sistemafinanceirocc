'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContaEmissora, ExecucaoResultado } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { boletosService, CAMPO_COBRANCA_LABEL } from '@/services/boletos';
import { medicosService, queryKeys as medicoQueryKeys } from '@/services/medicos';
import { DisparoBadges } from '@/components/boletos/DisparoBadges';
import { LoteEmissaoDialog } from './LoteEmissaoDialog';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function classeLabel(classe: string): string {
  switch (classe) {
    case 'PERCENTUAL_PRODUCAO':
      return '% da produção';
    case 'PRECO_PROPRIO':
      return 'Preço próprio';
    case 'CONSULTA_PEDIATRIA':
      return 'Consultas (pediatria)';
    default:
      return classe;
  }
}

/**
 * Auditoria "qual médico contribuiu quanto" de um resultado AGREGADO por empresa.
 * Busca sob demanda (só quando o `<details>` é aberto) — a lista de resultados normalmente não
 * precisa desse detalhe, só quando o operador quer conferir/disputar.
 */
function ContribuicoesEmpresa({ resultadoId }: { resultadoId: string }) {
  const [aberto, setAberto] = useState(false);
  const { data: medicos } = useQuery({
    queryKey: medicoQueryKeys.medicos(),
    queryFn: medicosService.listar,
  });
  const nomePorMedico = useMemo(() => new Map((medicos ?? []).map((m) => [m.id, m.nome])), [medicos]);

  const { data: contribuicoes, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.contribuicoes(resultadoId),
    queryFn: () => execucoesService.contribuicoes(resultadoId),
    enabled: aberto,
  });

  return (
    <details className="mt-2" onToggle={(e) => setAberto((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs font-medium text-cc-accent hover:underline">
        Ver contribuições por médico
      </summary>
      <div className="mt-2 overflow-x-auto">
        {isLoading ? (
          <p className="text-xs text-cc-muted">Carregando…</p>
        ) : !contribuicoes || contribuicoes.length === 0 ? (
          <p className="text-xs text-cc-muted">Nenhuma contribuição registrada.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-cc-muted">
                <th className="py-1 font-medium">Médico</th>
                <th className="py-1 font-medium text-right">Guias</th>
                <th className="py-1 font-medium text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {contribuicoes.map((c) => (
                <tr key={c.id} className="border-t border-cc-hairline">
                  <td className="py-1 text-cc-ink-2">{nomePorMedico.get(c.medicoId) ?? c.medicoId}</td>
                  <td className="py-1 text-right tabular text-cc-ink-2">{c.guias}</td>
                  <td className="py-1 text-right tabular text-cc-ink">{brl(c.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

/**
 * Total de guias somando TODOS os lotes (HAPVIDA_CRED/NAO_CRED, OUTROS_HOSPITAIS,
 * IMOBILIZACOES, PERCENTUAL_PRODUCAO, PRECO_PROPRIO) — achado real 2026-08-06 (Dr. Felipe de
 * Brito Rocha): `r.guias` (o campo usado aqui antes) só reflete o lote PRINCIPAL, nunca os
 * lotes separados (Story 10.5 — Outros Hospitais/Imobilizações vêm de produções à parte, com
 * contagem própria). O valor cobrado (`r.totalValor`) já soma tudo certo; só o texto do resumo
 * mostrava um número que parecia o total mas não era, confundindo quem revisa.
 * CONSULTA_PEDIATRIA fica de fora da soma — a unidade dela é "consultas", não "guias" (Story
 * 10.2), somar misturaria unidades diferentes.
 */
function totalGuiasTodosLotes(r: ExecucaoResultado): number {
  if (!r.subtotais || r.subtotais.length === 0) return r.guias ?? 0;
  return r.subtotais
    .filter((s) => s.classe !== 'CONSULTA_PEDIATRIA')
    .reduce((acc, s) => acc + s.guias, 0);
}

function normalizarBusca(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Relatório em três grupos: ok / alerta / sem_dados (PRD §8.4).
export function RelatorioGrupos({ execucaoId }: { execucaoId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId),
    queryFn: () => execucoesService.resultados(execucaoId),
  });
  const { toast } = useToast();
  const [emitidos, setEmitidos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  // Confirmação de emissão mostra POR QUAL EMPRESA o boleto sairá antes do clique final —
  // última barreira contra emissão pela conta errada.
  const [confirmandoEmissao, setConfirmandoEmissao] = useState<ExecucaoResultado | null>(null);
  const [loteAberto, setLoteAberto] = useState(false);
  const { data: medicos } = useQuery({
    queryKey: medicoQueryKeys.medicos(),
    queryFn: medicosService.listar,
  });
  const contaPorMedico = useMemo(
    () => new Map((medicos ?? []).map((m) => [m.id, m.contaEmissora])),
    [medicos],
  );

  // Revisão manual de 'alerta' → 'ok' (gap de arquitetura identificado 2026-07-08: um resultado
  // em alerta nunca tinha caminho de saída). Ao confirmar, o item some do grupo "alerta" e reaparece
  // em "ok" sozinho, via refetch — sem lógica manual de mover item entre grupos.
  const revisar = useMutation({
    mutationFn: ({ resultadoId, motivo }: { resultadoId: string; motivo: string }) =>
      execucoesService.revisarResultado(execucaoId, resultadoId, motivo),
    onSuccess: () => {
      toast('Resultado revisado e liberado para emissão', 'success');
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) });
    },
    onError: (e) => {
      if (e instanceof ApiClientError) {
        toast(e.message, 'error');
        return;
      }
      toast('Erro ao revisar resultado', 'error');
    },
  });

  // Emissão manual, um resultado por vez (PRD §10) — o botão "Emitir todos os pendentes" abaixo
  // é o fluxo em lote (revisão de arquitetura 2026-07-31, decisão 5): preview + confirmação
  // única + processamento assíncrono, sem pular a validação de cada item.
  const emitir = useMutation({
    mutationFn: (resultadoId: string) => boletosService.emitir(resultadoId),
    onSuccess: (_res, resultadoId) => {
      setEmitidos((prev) => new Set(prev).add(resultadoId));
      setConfirmandoEmissao(null);
      toast('Boleto emitido com sucesso', 'success');
    },
    onError: (e, resultadoId) => {
      setConfirmandoEmissao(null);
      if (e instanceof ApiClientError) {
        if (e.code === 'BOLETO_JA_EMITIDO') {
          setEmitidos((prev) => new Set(prev).add(resultadoId));
          toast('Este resultado já tem boleto emitido', 'info');
          return;
        }
        if (e.code === 'CONTA_NAO_CONFIGURADA') {
          // Débito D-721 (gate 7.2): conta da empresa ainda sem credenciais na Vercel.
          toast(e.message, 'error');
          return;
        }
        if (e.code === 'COBRANCA_INCOMPLETA') {
          const faltantes = (e.details?.faltantes as string[] | undefined) ?? [];
          const labels = faltantes.map((f) => CAMPO_COBRANCA_LABEL[f] ?? f).join(', ');
          toast(
            `Dados de cobrança incompletos (${labels || 'campos obrigatórios'}). Complete o cadastro do médico em Médicos.`,
            'error',
          );
          return;
        }
        toast(e.message, 'error');
        return;
      }
      toast('Erro ao emitir boleto', 'error');
    },
  });

  const reenviar = useMutation({
    mutationFn: (resultadoId: string) => boletosService.reenviar(resultadoId),
    onSuccess: () => {
      toast('Notificações reenviadas com sucesso', 'success');
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) });
    },
    onError: (e) => {
      toast(e instanceof ApiClientError ? e.message : 'Erro ao reenviar boleto', 'error');
    },
  });

  // Recalcula um resultado já gravado com os itens de produção ATUAIS da origem (achado real
  // 2026-08-04: dado corrigido no sistema de origem depois que a execução já tinha rodado, sem
  // forma de refletir a correção sem criar uma execução nova inteira).
  const recalcular = useMutation({
    mutationFn: (resultadoId: string) => execucoesService.recalcularResultado(resultadoId),
    onSuccess: () => {
      toast('Resultado recalculado com os dados atuais da origem', 'success');
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) });
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'BOLETO_JA_EMITIDO') {
        toast('Este resultado já tem boleto emitido — cancele o boleto antes de recalcular.', 'error');
        return;
      }
      toast(e instanceof ApiClientError ? e.message : 'Erro ao recalcular resultado', 'error');
    },
  });

  if (isLoading) return <p className="text-sm text-cc-muted">Carregando relatório…</p>;
  if (error) return <p className="alert-error">Falha ao carregar o relatório.</p>;

  const todos = data ?? [];
  // Total geral sempre soma TODOS os resultados, independente da busca — é valor financeiro e
  // não deve variar com o texto digitado (evita o usuário achar que o valor mudou).
  const totalGeral = todos.reduce((s, r) => s + (r.totalValor ?? 0), 0);

  const termoBusca = normalizarBusca(busca.trim());
  const filtrados = termoBusca
    ? todos.filter((r) => normalizarBusca(r.nome).includes(termoBusca))
    : todos;
  const ok = filtrados.filter((r) => r.status === 'ok');
  const alerta = filtrados.filter((r) => r.status === 'alerta');
  const semDados = filtrados.filter((r) => r.status === 'sem_dados');
  // Achado 2026-08-13: produção retida abaixo do mínimo de guias (regra da coordenadora
  // financeira) — precisa de grupo próprio, senão o médico fica invisível na tela (nenhum boleto
  // este mês, mas HÁ produção real represada, diferente de "sem dados").
  const acumulado = filtrados.filter((r) => r.status === 'acumulado');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar médico por nome..."
          aria-label="Buscar médico por nome"
          className="input max-w-xs"
        />
        {termoBusca && (
          <span className="text-xs text-cc-muted">
            Exibindo {filtrados.length} de {todos.length} médicos
          </span>
        )}
      </div>
      <Grupo
        titulo="Prontos para emissão"
        count={ok.length}
        cor="green"
        resultados={ok}
        emitidos={emitidos}
        emitindoId={emitir.isPending ? emitir.variables : null}
        onEmitir={(id) => {
          const resultado = ok.find((r) => r.id === id);
          if (resultado) setConfirmandoEmissao(resultado);
        }}
        reenviarPendingId={reenviar.isPending ? reenviar.variables : null}
        onReenviar={(id) => reenviar.mutate(id)}
        onRecalcular={(id) => recalcular.mutate(id)}
        recalcularPendingId={recalcular.isPending ? recalcular.variables : null}
        acaoEmLote={
          ok.length > 0 ? (
            <button onClick={() => setLoteAberto(true)} className="btn-secondary btn btn-sm">
              Emitir todos os pendentes
            </button>
          ) : undefined
        }
      />
      <Grupo
        titulo="Requerem revisão"
        count={alerta.length}
        cor="amber"
        resultados={alerta}
        mostrarAlertas
        onRevisar={(id, motivo) => revisar.mutate({ resultadoId: id, motivo })}
        revisarPendingId={revisar.isPending ? revisar.variables?.resultadoId : null}
        onRecalcular={(id) => recalcular.mutate(id)}
        recalcularPendingId={recalcular.isPending ? recalcular.variables : null}
      />
      <Grupo titulo="Sem dados no sistema" count={semDados.length} cor="gray" resultados={semDados} resumido />
      <Grupo
        titulo="Acumulado — aguardando o próximo mês"
        count={acumulado.length}
        cor="blue"
        resultados={acumulado}
        resumido
      />
      <div className="flex items-center justify-between border-t border-cc-hairline pt-4">
        <span className="font-mono text-2xs uppercase tracking-wider text-cc-muted">Total geral</span>
        <span className="tabular text-lg font-semibold text-cc-ink">{brl(totalGeral)}</span>
      </div>

      {confirmandoEmissao && (
        <EmitirBoletoDialog
          resultado={confirmandoEmissao}
          conta={
            confirmandoEmissao.medicoId
              ? (contaPorMedico.get(confirmandoEmissao.medicoId) ?? null)
              : null
          }
          confirmando={emitir.isPending}
          onConfirm={() => emitir.mutate(confirmandoEmissao.id)}
          onCancel={() => setConfirmandoEmissao(null)}
        />
      )}

      {loteAberto && (
        <LoteEmissaoDialog
          execucaoId={execucaoId}
          onClose={() => setLoteAberto(false)}
          onAlgumEmitido={() => void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) })}
        />
      )}
    </div>
  );
}

/**
 * A EMPRESA EMISSORA fica visível antes do clique final — o beneficiário do boleto é parte
 * da cobrança, não detalhe técnico. `conta` null = lista de médicos ainda carregando (ou
 * resultado sem médico): confirma desabilitado até resolver.
 */
function EmitirBoletoDialog({
  resultado,
  conta,
  confirmando,
  onConfirm,
  onCancel,
}: {
  resultado: ExecucaoResultado;
  conta: ContaEmissora | null;
  confirmando: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      titulo="Emitir boleto"
      largura="md"
      onClose={onCancel}
      // Emissão em voo: Escape/backdrop não podem fechar a confirmação enquanto o boleto está
      // sendo registrado no gateway.
      emVoo={confirmando}
      mensagemEmVoo="Aguarde a emissão terminar."
      rodape={
        <>
          <button onClick={onCancel} disabled={confirmando} className="btn-ghost btn btn-sm">
            Voltar
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmando || conta == null}
            className="btn-primary btn btn-sm"
            title={conta == null ? 'Aguardando a empresa emissora do médico' : undefined}
          >
            {confirmando ? 'Emitindo…' : 'Confirmar emissão'}
          </button>
        </>
      }
    >
      <p className="text-sm text-cc-ink-2">
        Emitir boleto de <strong>{brl(resultado.totalValor ?? 0)}</strong> para{' '}
        <strong>{resultado.nome}</strong>?
      </p>
      <p className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-4 py-3 text-sm text-cc-ink">
        Empresa emissora: <strong>{conta ? CONTA_EMISSORA_LABEL[conta] : 'carregando…'}</strong>
      </p>
      <p className="text-xs text-cc-muted">
        O boleto sai registrado em nome da empresa acima e as notificações (WhatsApp/e-mail) são
        enviadas ao médico automaticamente.
      </p>
    </Modal>
  );
}

function Grupo({
  titulo,
  count,
  cor,
  resultados,
  mostrarAlertas = false,
  resumido = false,
  emitidos,
  emitindoId,
  onEmitir,
  onRevisar,
  revisarPendingId,
  reenviarPendingId,
  onReenviar,
  onRecalcular,
  recalcularPendingId,
  acaoEmLote,
}: {
  titulo: string;
  count: number;
  cor: 'green' | 'amber' | 'gray' | 'blue';
  resultados: ExecucaoResultado[];
  mostrarAlertas?: boolean;
  resumido?: boolean;
  onRevisar?: (resultadoId: string, motivo: string) => void;
  revisarPendingId?: string | null;
  emitidos?: Set<string>;
  emitindoId?: string | null;
  onEmitir?: (resultadoId: string) => void;
  reenviarPendingId?: string | null;
  onReenviar?: (resultadoId: string) => void;
  /** Reprocessa o resultado com os itens de produção ATUAIS da origem — só oferecido para
   *  resultados de médico (não empresa/cliente) sem boleto emitido ainda. */
  onRecalcular?: (resultadoId: string) => void;
  recalcularPendingId?: string | null;
  /** Ação de lote no cabeçalho do grupo (ex.: "Emitir todos os pendentes") — o grupo não sabe o
   *  que é, só reserva o espaço; mantém a emissão individual intacta ao lado como fallback. */
  acaoEmLote?: React.ReactNode;
}) {
  const barra =
    cor === 'green' ? 'bg-cc-success' : cor === 'amber' ? 'bg-cc-warning' : cor === 'blue' ? 'bg-cc-accent' : 'bg-cc-muted';
  const badge =
    cor === 'green' ? 'badge-green' : cor === 'amber' ? 'badge-amber' : 'badge-slate';

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-cc-ink">
          <span className={`h-4 w-1 rounded-full ${barra}`} />
          {titulo}
          <span className={badge}>{count}</span>
        </h2>
        {acaoEmLote}
      </div>
      {resultados.length === 0 ? (
        <p className="pl-3.5 text-sm text-cc-muted">Nenhum médico neste grupo.</p>
      ) : (
        <ul className="space-y-2.5">
          {resultados.map((r) => (
            <li key={r.id} className="card card-interactive p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium text-cc-ink">
                  {r.nome}
                  {r.statusOriginal === 'alerta' && (
                    <span
                      className="badge-amber"
                      title={`${r.revisadoEm ? `Revisado em ${new Date(r.revisadoEm).toLocaleString('pt-BR')}` : 'Revisado manualmente'}${r.motivoRevisao ? `. Motivo: ${r.motivoRevisao}` : ''}`}
                    >
                      Revisado manualmente
                    </span>
                  )}
                </span>
                {!resumido && (
                  <span className="tabular font-semibold text-cc-ink">{brl(r.totalValor ?? 0)}</span>
                )}
              </div>
              {!resumido && (
                <div className="mt-1 font-mono text-2xs uppercase tracking-wide text-cc-muted">
                  {totalGuiasTodosLotes(r)} guias
                  {r.subtotais && r.subtotais.filter((s) => s.classe !== 'CONSULTA_PEDIATRIA').length > 1 && ' (todos os lotes)'}
                  {' · '}
                  {r.cirurgias ?? 0} cirurgias · consolidado {r.guiasConsolidado ?? 0}
                  {r.subtotais && r.subtotais.filter((s) => s.classe !== 'CONSULTA_PEDIATRIA').length > 1 && ' (lote principal)'}
                </div>
              )}
              {!resumido && r.subtotais && r.subtotais.length > 0 && (
                <div className="overflow-x-auto">
                <table className="mt-3 w-full text-xs">
                  <tbody>
                    {r.subtotais.map((s, i) => (
                      <tr key={i} className="border-t border-cc-hairline">
                        {/* Subtotais sintéticos (percentual, preço próprio, consultas pediatria):
                            label amigável; a memória de cálculo vem em `faixa`. */}
                        <td className="py-1.5 text-cc-ink-2">{classeLabel(s.classe)}</td>
                        <td className="py-1.5 tabular text-cc-ink-2">
                          {s.classe === 'PERCENTUAL_PRODUCAO'
                            ? '—'
                            : s.classe === 'CONSULTA_PEDIATRIA'
                              ? `${s.guias} consultas`
                              : `${s.guias} guias`}
                        </td>
                        <td className="py-1.5 text-cc-muted">{s.faixa}</td>
                        <td className="py-1.5 text-right tabular text-cc-ink">{brl(s.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              {!resumido && r.empresaId && <ContribuicoesEmpresa resultadoId={r.id} />}
              {mostrarAlertas &&
                r.alertas.map((a, i) => (
                  <p key={i} className="mt-1.5 flex gap-1.5 text-xs text-cc-warning">
                    <span aria-hidden>→</span> {a}
                  </p>
                ))}
              {resumido && r.alertas[0] && <p className="mt-1 text-xs text-cc-muted">{r.alertas[0]}</p>}
              {onRecalcular &&
                r.medicoId &&
                !(emitidos?.has(r.id) || (r.disparos && r.disparos.length > 0)) && (
                  <div className="mt-3 flex items-center justify-end border-t border-cc-hairline pt-3">
                    <button
                      type="button"
                      className="btn-ghost btn btn-sm"
                      disabled={recalcularPendingId != null}
                      title="Reprocessa este resultado com os itens de produção atuais da origem"
                      onClick={() => onRecalcular(r.id)}
                    >
                      {recalcularPendingId === r.id ? 'Recalculando…' : 'Recalcular'}
                    </button>
                  </div>
                )}
              {onRevisar && (
                <AcaoRevisar
                  pending={revisarPendingId === r.id}
                  onConfirmar={(motivo) => onRevisar(r.id, motivo)}
                />
              )}
              {onEmitir && (
                <div className="mt-3 flex flex-wrap items-center justify-between border-t border-cc-hairline pt-3">
                  <div className="flex gap-2">
                    <DisparoBadges disparos={r.disparos} />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {emitidos?.has(r.id) || (r.disparos && r.disparos.length > 0) ? (
                      <>
                        <span className="badge-green">Boleto emitido</span>
                        {onReenviar && (
                           <button
                             type="button"
                             className="btn-secondary btn btn-sm"
                             disabled={reenviarPendingId != null}
                             onClick={() => onReenviar(r.id)}
                           >
                             {reenviarPendingId === r.id ? 'Reenviando…' : 'Reenviar notificações'}
                           </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary btn btn-sm"
                        disabled={emitindoId != null}
                        onClick={() => onEmitir(r.id)}
                      >
                        {emitindoId === r.id ? 'Emitindo…' : 'Emitir boleto'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const MOTIVO_MIN = 5;

/**
 * Formulário inline de revisão — expande sob demanda, sem precisar de um modal novo.
 * Story 12.1: NÃO vira `<Modal>` (não é um diálogo em overlay; transformá-lo em modal seria uma
 * mudança de UX fora do escopo desta story — G-32/story 12.13 é quem mexe no conteúdo dele).
 * O que entra aqui é só a semântica de disclosure que faltava: `aria-expanded`/`aria-controls` e
 * foco indo para o campo ao expandir, mesma regra de foco inicial do `<Modal>` (G-38).
 */
function AcaoRevisar({
  pending,
  onConfirmar,
}: {
  pending: boolean;
  onConfirmar: (motivo: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const painelId = useId();
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const motivoRef = useRef<HTMLTextAreaElement>(null);

  // Foco no efeito (não no handler): ao fechar, o gatilho só volta a existir depois do render,
  // então `gatilhoRef.current` ainda é null dentro do onClick. `jaAbriu` evita roubar o foco na
  // primeira montagem, quando o painel nunca chegou a abrir.
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (aberto) {
      jaAbriu.current = true;
      motivoRef.current?.focus();
    } else if (jaAbriu.current) {
      gatilhoRef.current?.focus();
    }
  }, [aberto]);

  function fechar() {
    setAberto(false);
    setMotivo('');
  }

  if (!aberto) {
    return (
      <div className="mt-3 flex items-center justify-end border-t border-cc-hairline pt-3">
        <button
          ref={gatilhoRef}
          type="button"
          className="btn-secondary btn btn-sm"
          aria-expanded={false}
          aria-controls={painelId}
          onClick={() => setAberto(true)}
        >
          Revisar e liberar
        </button>
      </div>
    );
  }

  return (
    <div id={painelId} className="mt-3 space-y-2 border-t border-cc-hairline pt-3">
      <textarea
        ref={motivoRef}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo da liberação (obrigatório). Ex.: confirmado com o médico, aumento real de produção."
        aria-label="Motivo da liberação"
        rows={2}
        disabled={pending}
        className="input w-full"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-ghost btn btn-sm"
          disabled={pending}
          onClick={fechar}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary btn btn-sm"
          disabled={pending || motivo.trim().length < MOTIVO_MIN}
          onClick={() => onConfirmar(motivo.trim())}
        >
          {pending ? 'Confirmando…' : 'Confirmar liberação'}
        </button>
      </div>
    </div>
  );
}
