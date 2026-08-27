'use client';
// Cálculo em lote de clientes contábeis (feedback do dono, 2026-08-20): hoje só existia emissão
// individual (1 cliente por vez), sem o ganho de produtividade que o lote de médico já dá. Fluxo:
//   1. (só se algum selecionado for `faixa_faturamento`) lança o faturamento da competência em
//      massa — sem isso o cálculo desses clientes fica em alerta, mesma regra de sempre.
//   2. Cria a execução (POST /clientes-contabilidade/lote devolve o `execucaoId` na hora) e manda
//      processar (POST /execucoes/{id}/retomar, que aguarda terminar). O acompanhamento é pela
//      barra de progresso real — ver Story 12.5 mais abaixo.
//   3. Emissão em lote dos boletos REAPROVEITA o mecanismo já existente (LoteEmissaoDialog) sem
//      nenhuma mudança nele — já é agnóstico de médico/empresa/cliente contábil.
//
// Story 12.5 (R-3 + R-4, gaps G-06/G-08/G-11/G-12/G-13/G-15): o diálogo passou a (a) dizer a
// COMPOSIÇÃO do lote antes do clique, em vez de "Pronto pra calcular N clientes"; (b) mostrar os
// limites do sistema (teto de clientes e rate limit) ANTES de o servidor recusar; (c) acompanhar
// o cálculo com barra + % + role="status" reaproveitando `ProgressoExecucao`; (d) separar
// "A emitir" (só os `ok`) de "Total geral" no resumo; (e) manter o `execucaoId` recuperável.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClienteContabilidade } from '@cobranca/shared';
import { LOTE_CONTABILIDADE_MAX_CLIENTES, LOTE_CONTABILIDADE_MAX_POR_MINUTO } from '@cobranca/shared';
import { clientesContabilidadeService, clienteContabilidadeQueryKeys } from '@/services/clientes-contabilidade';
import type { ResultadoLancamentoFaturamentoLote } from '@/services/clientes-contabilidade';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CampoCompetencia } from '@/components/ui/CampoCompetencia';
import { LoteEmissaoDialog } from '@/components/execucoes/LoteEmissaoDialog';
import { ProgressoExecucao } from '@/components/execucoes/ProgressoExecucao';
import { cicloAdicionalVencendoNaCompetencia } from '@/lib/adicional-semestral';
import { brl } from '@/lib/formato';
import { competenciaAtual } from '@/lib/competencia';

/**
 * Story 12.5 (AC 5): rastro do cálculo em andamento. Fechar o diálogo — ou recarregar a página
 * porque a rede caiu no meio dos 300s — não pode mais significar "perdi a execução": o
 * `execucaoId` existe desde o primeiro instante (a rota de lote responde antes de processar) e
 * fica aqui até a execução concluir. `sessionStorage` e não `localStorage` de propósito: o rastro
 * morre com a aba, junto com a sessão de trabalho que o produziu.
 */
const CHAVE_LOTE_EM_ANDAMENTO = 'cc-lote-contabilidade-execucao';

interface LoteEmAndamento {
  competencia: string;
  execucaoId: string;
}

function lerLoteEmAndamento(): LoteEmAndamento | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_LOTE_EM_ANDAMENTO);
    if (!bruto) return null;
    const dados = JSON.parse(bruto) as Partial<LoteEmAndamento> | null;
    if (typeof dados?.execucaoId !== 'string' || !/^\d{4}-\d{2}$/.test(dados?.competencia ?? '')) {
      return null;
    }
    return { execucaoId: dados.execucaoId, competencia: dados.competencia! };
  } catch {
    /* sessionStorage indisponível ou conteúdo corrompido — segue sem recuperação */
    return null;
  }
}

function gravarLoteEmAndamento(valor: LoteEmAndamento | null): void {
  try {
    if (valor) sessionStorage.setItem(CHAVE_LOTE_EM_ANDAMENTO, JSON.stringify(valor));
    else sessionStorage.removeItem(CHAVE_LOTE_EM_ANDAMENTO);
  } catch {
    /* sessionStorage indisponível — recuperação vira um nice-to-have, nunca um erro na tela */
  }
}

export function LoteContabilidadeDialog({
  clientes,
  inativosSelecionados = [],
  onClose,
}: {
  /** Clientes ATIVOS já selecionados na tela (resolvidos pelo chamador — nome/modoCobranca). */
  clientes: ClienteContabilidade[];
  /**
   * Selecionados que ficaram de fora por estarem inativos (Story 12.5, AC 2 / gap G-15). Chegam
   * como prop porque só o chamador conhece a seleção inteira — e sem eles o diálogo repetiria a
   * divergência de contagem que a story existe para explicar ("10 selecionados" ao lado de
   * "Calcular em lote (7)").
   */
  inativosSelecionados?: ClienteContabilidade[];
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

  // AC 5: recuperação do cálculo em andamento, aplicada DEPOIS da montagem (mesmo cuidado de
  // hidratação do Sidebar — o servidor não tem sessionStorage). Restaura a competência junto,
  // senão o diálogo acompanharia a execução certa com o mês errado no cabeçalho.
  useEffect(() => {
    const salvo = lerLoteEmAndamento();
    if (!salvo) return;
    setCompetencia(salvo.competencia);
    setExecucaoId(salvo.execucaoId);
    // Só na montagem: recuperar é ato de abrir o diálogo, não reação a mudança de estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Story 12.5 (G-12): quem JÁ tem faturamento lançado na competência. Mesmo `staleTime: 0` da
  // guarda, e pelo mesmo motivo: o passo 1 acabou de escrever nessa tabela.
  const faturamentosLancadosQ = useQuery({
    queryKey: clienteContabilidadeQueryKeys.faturamentosLancados(competencia),
    queryFn: () => clientesContabilidadeService.faturamentosLancados(competencia),
    enabled: /^\d{4}-\d{2}$/.test(competencia),
    staleTime: 0,
  });
  const comFaturamentoLancado = useMemo(
    () => new Set(faturamentosLancadosQ.data?.clienteContabilidadeIds ?? []),
    [faturamentosLancadosQ.data],
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

  /**
   * Composição do lote (AC 1, gaps G-11/G-12). Todos os números saem de dado real — a partição
   * por `modoCobranca` que já existia, a consulta de faturamentos lançados e
   * `cicloAdicionalVencendoNaCompetencia` (a MESMA função usada na emissão individual,
   * `GerarExecucao.tsx`). Nada é estimado: enquanto a consulta de faturamento não responde, o
   * painel diz que não sabe em vez de mostrar "0 lançado".
   */
  const composicao = useMemo(() => {
    const faixaLancado = faixaFaturamento.filter((c) => comFaturamentoLancado.has(c.id)).length;
    return {
      fixo: elegiveis.filter((c) => c.modoCobranca === 'fixo').length,
      faixa: faixaFaturamento.length,
      faixaLancado,
      faixaPendente: faixaFaturamento.length - faixaLancado,
      // O adicional semestral continua FORA do lote (decisão D9, `execucao-orchestrator.ts`) —
      // aqui ele só vira aviso, pra que um ciclo vencendo não passe batido (G-11).
      adicionalVencendo: elegiveis.filter(
        (c) =>
          c.adicionalAtivo &&
          !!c.adicionalCompetenciaBase &&
          !!c.adicionalIntervaloMeses &&
          cicloAdicionalVencendoNaCompetencia(
            c.adicionalCompetenciaBase,
            c.adicionalIntervaloMeses,
            competencia,
          ),
      ),
    };
  }, [elegiveis, faixaFaturamento, comFaturamentoLancado, competencia]);

  const acimaDoTeto = elegiveis.length > LOTE_CONTABILIDADE_MAX_CLIENTES;

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
      // O painel de composição conta "lançado vs pendente" a partir do banco — depois de escrever
      // nele, a contagem exibida tem que ser revalidada, senão o resumo mente por conta própria.
      void qc.invalidateQueries({
        queryKey: clienteContabilidadeQueryKeys.faturamentosLancados(competencia),
      });
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
    // Dois passos, ambos AGUARDADOS (Story 12.5, AC 3/5): a rota de lote só CRIA a execução e
    // devolve o id na hora — o processamento vem depois, por `retomar`, que aguarda terminar antes
    // de responder. O `setExecucaoId` no meio é proposital: é ele que faz a barra de progresso
    // aparecer enquanto o cálculo roda, em vez de um botão "Calculando…" por até 300s.
    mutationFn: async () => {
      // `elegiveis`, não `clientes`: quem já tem boleto ativo na competência fica FORA do payload.
      const { execucaoId: novoId } = await clientesContabilidadeService.dispararLote({
        competencia,
        clienteContabilidadeIds: elegiveis.map((c) => c.id),
      });
      registrarExecucao(novoId);
      await execucoesService.retomar(novoId);
      return novoId;
    },
    // `retomar` só responde com o cálculo TERMINADO — não faz sentido a tela ficar mais 3s (o tick
    // do polling de fallback) mostrando barra de progresso de algo que já acabou.
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucao(id) });
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao calcular o lote', 'error'),
  });

  /** Estado + rastro persistido andam juntos — nunca um sem o outro (AC 5). */
  function registrarExecucao(id: string) {
    setExecucaoId(id);
    gravarLoteEmAndamento({ competencia, execucaoId: id });
  }

  // Estado da execução, só para decidir QUAL bloco mostrar (progresso vs. resumo). Observa a
  // MESMA chave que `useExecucaoRealtime` usa dentro de `ProgressoExecucao`, então não há fetch
  // nem canal Realtime a mais — é um segundo observador do mesmo cache, sem duplicar a lógica de
  // progresso/travamento que já mora lá.
  const execucaoQ = useQuery({
    queryKey: execucaoQueryKeys.execucao(execucaoId ?? ''),
    queryFn: () => execucoesService.detalhe(execucaoId!),
    enabled: !!execucaoId,
  });
  const calculoConcluido = execucaoQ.data?.status === 'concluido';

  // O rastro só existe enquanto há o que recuperar. Concluiu, apaga: reabrir o diálogo depois
  // disso tem que montar um lote NOVO, não voltar ao resumo de um lote já fechado (o histórico de
  // execuções é o lugar de rever um lote antigo).
  useEffect(() => {
    if (calculoConcluido) gravarLoteEmAndamento(null);
  }, [calculoConcluido]);

  // Rastro apontando para uma execução que não existe mais (404 — id antigo, execução removida).
  // Sem esta saída o diálogo ficaria preso: com `execucaoId` setado não há botão de calcular, e
  // fechar não adianta porque o rastro só é apagado quando a execução conclui. SÓ 404: uma falha
  // de rede transitória não pode tirar da tela um resultado que já está lá (para isso o
  // react-query ainda tenta de novo antes de marcar erro).
  const execucaoSumiu = execucaoQ.error instanceof ApiClientError && execucaoQ.error.status === 404;
  useEffect(() => {
    if (!execucaoSumiu) return;
    gravarLoteEmAndamento(null);
    setExecucaoId(null);
    toast('O cálculo anterior não está mais disponível — comece um lote novo.', 'info');
  }, [execucaoSumiu, toast]);

  // Só busca os resultados quando há resultado: antes disso a resposta seria uma lista parcial
  // (ou vazia) que viraria "Ok 0 · A emitir R$ 0,00" no meio do cálculo.
  const resultadosQ = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId ?? ''),
    queryFn: () => execucoesService.resultados(execucaoId!),
    enabled: !!execucaoId && calculoConcluido,
  });

  const resultados = useMemo(() => resultadosQ.data ?? [], [resultadosQ.data]);
  const totalOk = resultados.filter((r) => r.status === 'ok').length;
  const totalAlerta = resultados.filter((r) => r.status === 'alerta').length;
  // AC 4 (G-08): "A emitir" soma SÓ os `ok` — são os únicos que viram boleto. O total de todos os
  // resultados continua visível como linha secundária ("Total geral"), porque some junto com os
  // alertas de valor calculado seria esconder dinheiro que existe no cálculo mas não na cobrança.
  const valorAEmitir = resultados
    .filter((r) => r.status === 'ok')
    .reduce((acc, r) => acc + (r.totalValor ?? 0), 0);
  const valorTotalGeral = resultados.reduce((acc, r) => acc + (r.totalValor ?? 0), 0);

  function fecharTudo() {
    // AC 5: fechar no MEIO do cálculo NÃO limpa o rastro de propósito — reabrir o diálogo volta a
    // acompanhar a mesma execução em vez de perdê-la. Quem apaga é o efeito de conclusão acima.
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
        // Lançar faturamento em massa é uma escrita sem rastro consultável: fechar por
        // Escape/backdrop no meio deixaria o operador sem saber quem foi lançado. Já o CÁLCULO só
        // trava o fechamento até existir `execucaoId` — a partir daí (Story 12.5, AC 5) fechar é
        // seguro, porque o id fica persistido e reabrir o diálogo volta a acompanhar a mesma
        // execução em vez de perdê-la.
        emVoo={lancarFaturamentos.isPending || (calcular.isPending && !execucaoId)}
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
                disabled={calcular.isPending || !guardaPronta || acimaDoTeto}
                className="btn-primary btn btn-sm"
              >
                {calcular.isPending
                  ? 'Calculando…'
                  : !guardaPronta
                    ? 'Verificando emissões…'
                    : acimaDoTeto
                      ? `Acima do teto de ${LOTE_CONTABILIDADE_MAX_CLIENTES}`
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

        {/* Falhas do lançamento em massa (Story 12.4, AC 2) — bloco PERSISTENTE, por NOME do
            cliente, no mesmo formato da importação de planilha em ClientesContabilidadeManager
            (`alert-*` + lista `nome: motivo`). Persistente no sentido de NÃO ser toast: sobrevive
            ao avanço do passo 1 para o passo de cálculo e a quantas remontagens do passo 1 o
            operador precisar. Débito DEB-12.4-A: o comentário antigo prometia mais do que o código
            entrega — o guard `!execucaoId` abaixo retira o bloco assim que o lote é calculado, e o
            que aparece a partir daí é a lista de alertas do resultado (para onde quem falhou aqui
            vai justamente cair). */}
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

        {/* AC 1/2 (R-4): composição do lote no lugar de "Pronto pra calcular N clientes". Fica
            visível durante o passo 1 também — saber que 12 dos 18 já têm faturamento lançado é
            justamente o que evita redigitar tudo. */}
        {!execucaoId && elegiveis.length > 0 && (
          <div className="rounded-lg border border-cc-hairline bg-cc-surface-2 px-4 py-3">
            <h3 className="text-sm font-medium text-cc-ink">
              Composição do lote — <span className="tabular">{competencia}</span>
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-cc-ink-2">
              <li>
                <strong className="tabular text-cc-ink">{composicao.faixa}</strong> em faixa de faturamento
                {composicao.faixa > 0 &&
                  (faturamentosLancadosQ.isSuccess ? (
                    <>
                      {' '}
                      (<span className="tabular">{composicao.faixaLancado}</span> com faturamento lançado ·{' '}
                      <span className="tabular">{composicao.faixaPendente}</span> pendente
                      {composicao.faixaPendente !== 1 ? 's' : ''})
                    </>
                  ) : (
                    <span className="text-cc-muted">
                      {faturamentosLancadosQ.isError
                        ? ' (não foi possível verificar quais já têm faturamento lançado)'
                        : ' (verificando quais já têm faturamento lançado…)'}
                    </span>
                  ))}
              </li>
              <li>
                <strong className="tabular text-cc-ink">{composicao.fixo}</strong> em valor fixo
              </li>
              {composicao.adicionalVencendo.length > 0 && (
                <li className="text-cc-warning">
                  <strong className="tabular">{composicao.adicionalVencendo.length}</strong> com adicional
                  semestral vencendo em <span className="tabular">{competencia}</span> — não incluído neste
                  lote, gere individualmente ({composicao.adicionalVencendo.map((c) => c.nome).join(', ')})
                </li>
              )}
              {inativosSelecionados.length > 0 && (
                <li className="text-cc-muted">
                  <strong className="tabular">{inativosSelecionados.length}</strong> inativo
                  {inativosSelecionados.length !== 1 ? 's' : ''} removido
                  {inativosSelecionados.length !== 1 ? 's' : ''} da seleção
                </li>
              )}
            </ul>
            {/* AC 1 (G-13): os limites do sistema aparecem ANTES do clique — antes só existiam
                como 422/429 depois de o operador já ter perdido o disparo. */}
            <p className="mt-2 text-2xs text-cc-muted">
              Limites: até <span className="tabular">{LOTE_CONTABILIDADE_MAX_CLIENTES}</span> clientes por
              lote · no máximo <span className="tabular">{LOTE_CONTABILIDADE_MAX_POR_MINUTO}</span> cálculos
              por minuto.
            </p>
            {acimaDoTeto && (
              <p role="alert" className="alert-warning mt-2">
                A seleção tem {elegiveis.length} clientes para calcular, acima do teto de{' '}
                {LOTE_CONTABILIDADE_MAX_CLIENTES} por lote. Reduza a seleção e calcule em mais de uma
                rodada.
              </p>
            )}
          </div>
        )}

        {execucaoId && (
          <div className="space-y-3">
            {/* AC 3 (R-3/G-06): barra + % + role="status" + aviso de travamento com "Reprocessar",
                REAPROVEITANDO `ProgressoExecucao` (que já traz `useExecucaoRealtime` e o limiar de
                travamento) — nada disso é reimplementado aqui. Some quando conclui, dando lugar ao
                resumo abaixo, que é a informação que interessa a partir daí. */}
            {!calculoConcluido && (
              <ProgressoExecucao execucaoId={execucaoId} rotulo="Calculando clientes contábeis" />
            )}

            {calculoConcluido && resultadosQ.isLoading && (
              <p className="text-sm text-cc-muted">Carregando resultado do lote…</p>
            )}

            {calculoConcluido && !resultadosQ.isLoading && (
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
                    <dt className="text-2xs uppercase tracking-wide text-cc-muted">
                      A emitir ({totalOk} ok)
                    </dt>
                    <dd className="tabular font-semibold text-cc-ink">{brl(valorAEmitir)}</dd>
                    <dd className="mt-0.5 text-2xs text-cc-muted">
                      Total geral <span className="tabular">{brl(valorTotalGeral)}</span>
                    </dd>
                  </div>
                </dl>
                {totalAlerta > 0 && (
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
