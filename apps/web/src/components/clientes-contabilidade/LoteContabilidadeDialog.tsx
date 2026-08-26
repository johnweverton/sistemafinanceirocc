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
import type { ResultadoLancamentoFaturamentoLote } from '@/services/clientes-contabilidade';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
  // Resultado do último lançamento em massa (Story 12.4): fica no estado porque as falhas viram um
  // BLOCO PERSISTENTE na tela, não um toast que some em 4s levando junto a única pista de quem
  // ficou sem faturamento lançado.
  const [ultimoLancamento, setUltimoLancamento] = useState<ResultadoLancamentoFaturamentoLote | null>(null);
  // `null` = passo 1 com todos os clientes de faixa; array = passo 1 remontado só com quem falhou
  // ("Tentar de novo (N)"), pra não reenviar quem já teve o faturamento lançado com sucesso.
  const [pendentesRetry, setPendentesRetry] = useState<string[] | null>(null);
  // Troca de competência com valores digitados (RS-3) — ver `trocarCompetencia`.
  const [trocaCompetencia, setTrocaCompetencia] = useState<{
    de: string;
    para: string;
    valores: Record<string, string>;
  } | null>(null);

  // Guarda de duplicidade (Story 12.3, risco RS-1): clientes que JÁ têm boleto ativo
  // (emitido/pago) nesta competência, em qualquer execução. Sem isso, rodar o mesmo lote/mês duas
  // vezes — por engano ou em duas sessões — gerava um segundo boleto pro mesmo cliente, porque
  // cada disparo cria uma execução (e uma linha de resultado) NOVA, que a idempotência por
  // `execucao_resultado_id` não pega. Mesmo desenho de NovaExecucao.tsx para médicos.
  // Chaveado por competência: trocar o mês refaz a consulta e a lista de excluídos muda junto.
  // `staleTime: 0` explícito (débito DEB-12.3-B, story 12.4 AC 5): o padrão do app é
  // `staleTime: 30_000` (`app/providers.tsx`) e o `force-dynamic` da rota só desliga o cache HTTP —
  // não o cache do react-query. Com o padrão global, reabrir o diálogo logo depois de uma emissão
  // servia a lista antiga por até 30s, que é exatamente a janela em que a guarda precisa acertar.
  const comBoletoQ = useQuery({
    queryKey: clienteContabilidadeQueryKeys.comBoleto(competencia),
    queryFn: () => clientesContabilidadeService.comBoleto(competencia),
    enabled: /^\d{4}-\d{2}$/.test(competencia),
    staleTime: 0,
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
  // Quem o passo 1 pede/envia AGORA: todos os de faixa, ou só os pendentes de um "Tentar de novo".
  const alvosFaturamento = useMemo(
    () => (pendentesRetry ? faixaFaturamento.filter((c) => pendentesRetry.includes(c.id)) : faixaFaturamento),
    [faixaFaturamento, pendentesRetry],
  );
  const precisaFaturamento = alvosFaturamento.length > 0 && !faturamentoLancado;
  // Lançamento em massa exige pelo menos um valor: mandar lista vazia só produziria um 422 do
  // schema (`min(1)`) — e, com a regra do AC 1, um 422 nunca faria o passo avançar.
  const lancamentosValidos = useMemo(
    () =>
      alvosFaturamento
        .map((c) => ({ clienteContabilidadeId: c.id, faturamento: Number(faturamentos[c.id]) }))
        .filter(
          (l) =>
            faturamentos[l.clienteContabilidadeId]?.trim() &&
            !Number.isNaN(l.faturamento) &&
            l.faturamento >= 0,
        ),
    [alvosFaturamento, faturamentos],
  );
  // Não dá pra "remover do payload antes do cálculo" sem saber quem remover: enquanto a checagem
  // não responde, calcular fica bloqueado. (Tratamento de erro vs. vazio nos pontos de carga é
  // escopo da story 12.6 — aqui fica só a linha mínima de estado.)
  const guardaPronta = comBoletoQ.isSuccess;

  const lancarFaturamentos = useMutation({
    mutationFn: () => clientesContabilidadeService.lancarFaturamentoLote(competencia, lancamentosValidos),
    // AC 1 (bug de fluxo, RS-3): `setFaturamentoLancado(true)` rodava aqui INCONDICIONALMENTE — com
    // 12 de 12 falhas o passo 1 dava por encerrado e o operador seguia pro cálculo achando que os
    // faturamentos estavam lançados (e depois recebia 12 alertas sem explicação). Agora só avança
    // com pelo menos um lançamento bem-sucedido; 100% de falha CONTINUA no passo 1.
    onSuccess: (resultado) => {
      setUltimoLancamento(resultado);
      if (resultado.lancados === 0) {
        toast(
          resultado.falhas.length > 0
            ? `Nenhum faturamento lançado — ${resultado.falhas.length} falha(s)`
            : 'Nenhum faturamento lançado',
          'error',
        );
        return;
      }
      setFaturamentoLancado(true);
      if (resultado.falhas.length > 0) {
        toast(`${resultado.lancados} faturamento(s) lançado(s); ${resultado.falhas.length} falha(s)`, 'info');
      } else {
        toast(`${resultado.lancados} faturamento(s) lançado(s)`, 'success');
      }
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao lançar faturamentos', 'error'),
  });

  /** Remonta o passo 1 só com quem falhou (AC 3) — quem já foi lançado não é reenviado. */
  function tentarDeNovo(ids: string[]) {
    setPendentesRetry(ids);
    setFaturamentoLancado(false);
  }

  /**
   * Troca de competência (AC 4, risco RS-3 — lançar em massa no mês errado). Estado seguro
   * primeiro: os valores digitados são SEMPRE limpos junto com a competência; reaproveitá-los no
   * mês novo exige confirmação explícita ("manter os N valores digitados para 2026-08?"). Sem
   * valores digitados não há o que perguntar — troca direta, como antes.
   */
  function trocarCompetencia(valor: string) {
    if (valor === competencia) return;
    const digitados = Object.entries(faturamentos).filter(([, v]) => v.trim() !== '');
    setCompetencia(valor);
    setFaturamentoLancado(false);
    setUltimoLancamento(null);
    setPendentesRetry(null);
    setFaturamentos({});
    if (digitados.length > 0) {
      setTrocaCompetencia({ de: competencia, para: valor, valores: Object.fromEntries(digitados) });
    }
  }

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
    <>
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
          onChange={trocarCompetencia}
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

        {/* Falhas do lançamento em massa (AC 2) — bloco PERSISTENTE, por NOME do cliente, no mesmo
            formato da importação de planilha em ClientesContabilidadeManager (`alert-*` + lista
            `nome: motivo`). Sobrevive ao avanço pro passo de cálculo: quem falhou aqui vai virar
            alerta lá, e o operador precisa continuar enxergando quem foi. */}
        {!execucaoId && ultimoLancamento && ultimoLancamento.falhas.length > 0 && (
          <div className={ultimoLancamento.lancados === 0 ? 'alert-error' : 'alert-warning'}>
            <p className="font-medium">
              {ultimoLancamento.lancados === 0
                ? `Nenhum faturamento lançado: ${ultimoLancamento.falhas.length} falha(s).`
                : `${ultimoLancamento.lancados} faturamento(s) lançado(s), ${ultimoLancamento.falhas.length} falha(s).`}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {ultimoLancamento.falhas.map((f) => (
                <li key={f.clienteContabilidadeId}>
                  {f.nome}: {f.motivo}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => tentarDeNovo(ultimoLancamento.falhas.map((f) => f.clienteContabilidadeId))}
              className="btn-primary btn btn-sm mt-3"
            >
              Tentar de novo ({ultimoLancamento.falhas.length} que falharam)
            </button>
          </div>
        )}

        {!execucaoId && elegiveis.length > 0 && precisaFaturamento && (
          <div className="space-y-3 rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4">
            <p className="text-sm text-cc-ink-2">
              {pendentesRetry
                ? `${alvosFaturamento.length} cliente${alvosFaturamento.length !== 1 ? 's' : ''} que falharam — confira o valor e lance de novo o faturamento de ${competencia} (quem já foi lançado não é reenviado).`
                : `${alvosFaturamento.length} cliente${alvosFaturamento.length !== 1 ? 's' : ''} no modo “faixa de faturamento” — lance o faturamento de ${competencia} pra cada um (opcional: quem ficar em branco entra no lote como alerta, sem travar os demais).`}
            </p>
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {alvosFaturamento.map((c) => (
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
            {/* AC 5 (débito DEB-12.3-B): lançar faturamento também espera a guarda de duplicidade —
                antes só "Calcular" respeitava `guardaPronta`, então dava pra lançar faturamento em
                massa (e escrever no banco) pra um cliente que a guarda ainda ia excluir do lote. */}
            <button
              type="button"
              onClick={() => lancarFaturamentos.mutate()}
              disabled={lancarFaturamentos.isPending || !guardaPronta || lancamentosValidos.length === 0}
              className="btn-primary btn btn-sm"
            >
              {lancarFaturamentos.isPending
                ? 'Lançando…'
                : !guardaPronta
                  ? 'Verificando emissões…'
                  : lancamentosValidos.length === 0
                    ? 'Digite ao menos um faturamento'
                    : 'Lançar faturamentos e continuar'}
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

      {/* AC 4 (RS-3): os valores já foram limpos junto com a troca — esta confirmação existe só pra
          REAPROVEITÁ-LOS na competência nova, nunca pra "deixar como estava" por omissão. Escape /
          backdrop / Cancelar caem no lado seguro (campos em branco). */}
      {trocaCompetencia && (
        <ConfirmDialog
          titulo="Manter os valores digitados?"
          tone="neutral"
          mensagem={`Você tinha ${Object.keys(trocaCompetencia.valores).length} valor(es) de faturamento digitado(s) com a competência ${trocaCompetencia.de} selecionada. Os campos foram limpos ao trocar para ${trocaCompetencia.para} — manter os ${Object.keys(trocaCompetencia.valores).length} valores digitados para ${trocaCompetencia.para}?`}
          itens={Object.entries(trocaCompetencia.valores).map(([id, valor]) => {
            const nome = clientes.find((c) => c.id === id)?.nome ?? id;
            const numero = Number(valor);
            return `${nome}: ${Number.isNaN(numero) ? valor : brl(numero)}`;
          })}
          confirmLabel={`Manter os ${Object.keys(trocaCompetencia.valores).length} valores em ${trocaCompetencia.para}`}
          cancelLabel="Descartar e digitar de novo"
          onConfirm={() => {
            setFaturamentos(trocaCompetencia.valores);
            setTrocaCompetencia(null);
          }}
          onCancel={() => setTrocaCompetencia(null)}
        />
      )}
    </>
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
