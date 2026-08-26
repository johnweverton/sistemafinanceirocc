'use client';
// Cálculo em lote de clientes contábeis (feedback do dono, 2026-08-20): hoje só existia emissão
// individual (1 cliente por vez), sem o ganho de produtividade que o lote de médico já dá. Fluxo:
//   1. (só se algum selecionado for `faixa_faturamento`) lança o faturamento da competência em
//      massa — sem isso o cálculo desses clientes fica em alerta, mesma regra de sempre.
//   2. Calcula o lote inteiro numa chamada só (POST /clientes-contabilidade/lote) — sem polling:
//      a rota AGUARDA o cálculo terminar antes de responder (mesmo padrão de POST /execucoes).
//   3. Emissão em lote dos boletos REAPROVEITA o mecanismo já existente (LoteEmissaoDialog) sem
//      nenhuma mudança nele — já é agnóstico de médico/empresa/cliente contábil.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClienteContabilidade } from '@cobranca/shared';
import { clientesContabilidadeService, clienteContabilidadeQueryKeys } from '@/services/clientes-contabilidade';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { CampoCompetencia } from '@/components/ui/CampoCompetencia';
import { LoteEmissaoDialog } from '@/components/execucoes/LoteEmissaoDialog';
import { brl } from '@/lib/formato';
import { competenciaAtual } from '@/lib/competencia';

export function LoteContabilidadeDialog({
  clientes,
  onClose,
}: {
  /** Clientes JÁ selecionados na tela (resolvidos pelo chamador — nome/modoCobranca). */
  clientes: ClienteContabilidade[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [faturamentos, setFaturamentos] = useState<Record<string, string>>({});
  const [faturamentoLancado, setFaturamentoLancado] = useState(false);
  const [execucaoId, setExecucaoId] = useState<string | null>(null);
  const [mostrarEmissao, setMostrarEmissao] = useState(false);

  // Guarda de duplicidade (Story 12.3, risco RS-1): clientes que JÁ têm boleto ativo
  // (emitido/pago) nesta competência, em qualquer execução. Sem isso, rodar o mesmo lote/mês duas
  // vezes — por engano ou em duas sessões — gerava um segundo boleto pro mesmo cliente, porque
  // cada disparo cria uma execução (e uma linha de resultado) NOVA, que a idempotência por
  // `execucao_resultado_id` não pega. Mesmo desenho de NovaExecucao.tsx para médicos.
  // Chaveado por competência: trocar o mês refaz a consulta e a lista de excluídos muda junto.
  // Sem `staleTime` de propósito — precisa refletir uma emissão feita há segundos.
  const comBoletoQ = useQuery({
    queryKey: clienteContabilidadeQueryKeys.comBoleto(competencia),
    queryFn: () => clientesContabilidadeService.comBoleto(competencia),
    enabled: /^\d{4}-\d{2}$/.test(competencia),
  });
  const clientesComBoletoAtivo = useMemo(
    () => new Set(comBoletoQ.data?.clienteContabilidadeIds ?? []),
    [comBoletoQ.data],
  );

  // Bloqueio duro, sem opt-in nem exceção por cliente (decisão do dono): quem está em
  // `jaEmitidos` simplesmente não entra no payload do cálculo. Cancelar o boleto anterior é o
  // caminho legítimo — boleto `cancelado` não conta como ativo na consulta do servidor.
  const { elegiveis, jaEmitidos } = useMemo(() => {
    const elegiveis: ClienteContabilidade[] = [];
    const jaEmitidos: ClienteContabilidade[] = [];
    for (const c of clientes) {
      if (clientesComBoletoAtivo.has(c.id)) jaEmitidos.push(c);
      else elegiveis.push(c);
    }
    return { elegiveis, jaEmitidos };
  }, [clientes, clientesComBoletoAtivo]);

  // Só faz sentido pedir faturamento de quem vai ser calculado — quem foi excluído pela guarda
  // não entra no lote, então também não entra no lançamento em massa.
  const faixaFaturamento = useMemo(
    () => elegiveis.filter((c) => c.modoCobranca === 'faixa_faturamento'),
    [elegiveis],
  );
  const precisaFaturamento = faixaFaturamento.length > 0 && !faturamentoLancado;
  // Não dá pra "remover do payload antes do cálculo" sem saber quem remover: enquanto a checagem
  // não responde, calcular fica bloqueado. (Tratamento de erro vs. vazio nos pontos de carga é
  // escopo da story 12.6 — aqui fica só a linha mínima de estado.)
  const guardaPronta = comBoletoQ.isSuccess;

  const lancarFaturamentos = useMutation({
    mutationFn: () => {
      const lancamentos = faixaFaturamento
        .map((c) => ({ clienteContabilidadeId: c.id, faturamento: Number(faturamentos[c.id]) }))
        .filter((l) => faturamentos[l.clienteContabilidadeId]?.trim() && !Number.isNaN(l.faturamento) && l.faturamento >= 0);
      return clientesContabilidadeService.lancarFaturamentoLote(competencia, lancamentos);
    },
    onSuccess: (resultado) => {
      setFaturamentoLancado(true);
      if (resultado.falhas.length > 0) {
        toast(`${resultado.lancados} faturamento(s) lançado(s); ${resultado.falhas.length} falha(s)`, 'info');
      } else if (resultado.lancados > 0) {
        toast(`${resultado.lancados} faturamento(s) lançado(s)`, 'success');
      }
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao lançar faturamentos', 'error'),
  });

  const calcular = useMutation({
    mutationFn: () =>
      // `elegiveis`, não `clientes`: quem já tem boleto ativo na competência fica FORA do payload.
      clientesContabilidadeService.dispararLote({
        competencia,
        clienteContabilidadeIds: elegiveis.map((c) => c.id),
      }),
    onSuccess: (r) => setExecucaoId(r.execucaoId),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao calcular o lote', 'error'),
  });

  // Sem polling: a rota já devolve o execucaoId com o cálculo CONCLUÍDO (aguardou internamente,
  // mesmo padrão de POST /execucoes) — 1 busca única já traz o resultado final.
  const resultadosQ = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId ?? ''),
    queryFn: () => execucoesService.resultados(execucaoId!),
    enabled: !!execucaoId,
  });

  const resultados = resultadosQ.data ?? [];
  const totalOk = resultados.filter((r) => r.status === 'ok').length;
  const totalAlerta = resultados.filter((r) => r.status === 'alerta').length;
  const totalValor = resultados.reduce((acc, r) => acc + (r.totalValor ?? 0), 0);

  function fecharTudo() {
    void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucoes() });
    // Reabrir o diálogo depois de emitir tem que enxergar os boletos recém-criados, senão o
    // guard fica obsoleto justamente na 2ª rodada — que é o cenário que ele existe pra impedir.
    void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.comBoleto(competencia) });
    onClose();
  }

  // Modal-dentro-de-modal (G-39): o diálogo de emissão SUBSTITUI este no mesmo lugar. Para o
  // operador não se perder, o título carrega o breadcrumb do lote ("Lote 2026-08 · Emitir
  // boletos") e o rodapé ganha "← Voltar ao lote" ao lado de "Fechar" — voltar retorna ao
  // resumo do lote, fechar encerra o fluxo inteiro (mesma semântica do "Fechar" daqui).
  if (mostrarEmissao && execucaoId) {
    return (
      <LoteEmissaoDialog
        execucaoId={execucaoId}
        tituloPrefixo={`Lote ${competencia}`}
        onVoltar={() => setMostrarEmissao(false)}
        onClose={fecharTudo}
        onAlgumEmitido={() => {
          void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) });
          void qc.invalidateQueries({ queryKey: clienteContabilidadeQueryKeys.comBoleto(competencia) });
        }}
      />
    );
  }

  return (
    <Modal
      titulo={`Calcular em lote — ${clientes.length} cliente${clientes.length !== 1 ? 's' : ''}`}
      largura="2xl"
      onClose={fecharTudo}
      // Lançamento de faturamento e cálculo do lote são requisições síncronas longas: fechar por
      // Escape/backdrop no meio deixaria o operador sem o resultado que já está sendo produzido.
      emVoo={lancarFaturamentos.isPending || calcular.isPending}
      mensagemEmVoo="Aguarde o processamento terminar."
      corpoClassName="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-4"
      rodape={
        <>
          <button onClick={fecharTudo} className="btn-ghost btn btn-sm">
            {execucaoId ? 'Fechar' : 'Cancelar'}
          </button>
          {!execucaoId && !precisaFaturamento && elegiveis.length > 0 && (
            <button
              onClick={() => calcular.mutate()}
              disabled={calcular.isPending || !guardaPronta}
              className="btn-primary btn btn-sm"
            >
              {calcular.isPending
                ? 'Calculando…'
                : !guardaPronta
                  ? 'Verificando emissões…'
                  : `Calcular ${elegiveis.length} em lote`}
            </button>
          )}
          {execucaoId && totalOk > 0 && (
            <button onClick={() => setMostrarEmissao(true)} className="btn-primary btn btn-sm">
              Emitir boletos em lote
            </button>
          )}
        </>
      }
    >
      <CampoCompetencia
        containerClassName="max-w-[10rem]"
        value={competencia}
        onChange={(valor) => {
          setCompetencia(valor);
          setFaturamentoLancado(false);
        }}
        disabled={!!execucaoId}
      />

      {/* Guarda de duplicidade — mesmo tratamento visual do bloco de médicos em NovaExecucao.
          Aparece ANTES do clique em calcular e some sozinho quando a competência muda pra um mês
          em que ninguém foi cobrado ainda. Sem opt-in: não há como reincluir estes clientes. */}
      {!execucaoId && jaEmitidos.length > 0 && (
        <div className="rounded-lg border border-cc-hairline bg-cc-surface-2/60 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 font-medium text-cc-ink-2">
            <CheckCircleIcon className="shrink-0 text-cc-muted" />
            Já emitido nesta competência ({jaEmitidos.length})
          </h3>
          <p className="mb-3 text-xs text-cc-muted">
            Estes clientes já têm boleto emitido/pago para {competencia} (de uma execução anterior) e foram
            excluídos do lote. Para cobrar de novo, cancele o boleto anterior.
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {jaEmitidos.map((c) => (
              <div key={c.id} className="rounded bg-cc-surface-2 p-1.5 text-xs text-cc-ink-2">
                {c.nome}
              </div>
            ))}
          </div>
        </div>
      )}

      {!execucaoId && comBoletoQ.isError && (
        <p className="alert-error">
          Não foi possível checar quem já tem boleto nesta competência — o cálculo fica bloqueado até a
          checagem responder.
        </p>
      )}

      {!execucaoId && elegiveis.length === 0 && jaEmitidos.length > 0 && (
        <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-4 py-3">
          <p className="text-sm text-cc-ink">
            Todos os clientes selecionados já têm boleto ativo em{' '}
            <strong className="tabular">{competencia}</strong> — não há nada para calcular.
          </p>
        </div>
      )}

      {!execucaoId && elegiveis.length > 0 && precisaFaturamento && (
        <div className="space-y-3 rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4">
          <p className="text-sm text-cc-ink-2">
            {faixaFaturamento.length} cliente{faixaFaturamento.length !== 1 ? 's' : ''} no modo &ldquo;faixa de
            faturamento&rdquo; — lance o faturamento de {competencia} pra cada um (opcional: quem ficar em
            branco entra no lote como alerta, sem travar os demais).
          </p>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {faixaFaturamento.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="flex-1 truncate text-sm text-cc-ink">{c.nome}</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={faturamentos[c.id] ?? ''}
                  onChange={(e) => setFaturamentos((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  placeholder="0.00"
                  className="input w-32 tabular"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => lancarFaturamentos.mutate()}
            disabled={lancarFaturamentos.isPending}
            className="btn-primary btn btn-sm"
          >
            {lancarFaturamentos.isPending ? 'Lançando…' : 'Lançar faturamentos e continuar'}
          </button>
        </div>
      )}

      {!execucaoId && elegiveis.length > 0 && !precisaFaturamento && (
        <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-4 py-3">
          <p className="text-sm text-cc-ink">
            Pronto pra calcular <strong>{elegiveis.length}</strong> cliente{elegiveis.length !== 1 ? 's' : ''} da
            competência <strong className="tabular">{competencia}</strong>.
          </p>
        </div>
      )}

      {execucaoId && (
        <div className="space-y-3">
          {resultadosQ.isLoading ? (
            <p className="text-sm text-cc-muted">Carregando resultado do lote…</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-lg border border-cc-hairline p-2">
                  <dt className="text-2xs uppercase tracking-wide text-cc-muted">Ok</dt>
                  <dd className="tabular font-semibold text-cc-success">{totalOk}</dd>
                </div>
                <div className="rounded-lg border border-cc-hairline p-2">
                  <dt className="text-2xs uppercase tracking-wide text-cc-muted">Alerta</dt>
                  <dd className="tabular font-semibold text-cc-warning">{totalAlerta}</dd>
                </div>
                <div className="rounded-lg border border-cc-hairline p-2">
                  <dt className="text-2xs uppercase tracking-wide text-cc-muted">Total</dt>
                  <dd className="tabular font-semibold text-cc-ink">{brl(totalValor)}</dd>
                </div>
              </dl>
              {resultados.filter((r) => r.status === 'alerta').length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-cc-hairline bg-cc-surface-2 p-3 text-xs text-cc-ink-2">
                  {resultados
                    .filter((r) => r.status === 'alerta')
                    .map((r) => (
                      <li key={r.id}>
                        <strong>{r.nome}</strong>: {r.alertas[0] ?? 'alerta sem detalhe'}
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Ícone SVG inline — mesmo padrão local usado em NovaExecucao/Sidebar (não há biblioteca de
 * ícones compartilhada no projeto; consolidá-los não é escopo desta story). */
function CheckCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}
