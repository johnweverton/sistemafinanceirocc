// Contratos de entrada/saída do motor (Engine). Funções puras, sem I/O.
import type { Medico } from '../types/medico';
import type { ExecucaoResultado, Subtotal } from '../types/execucao';

/** Resultado da contagem de guias (PRD §5.2). */
export interface ResultadoContagem {
  guias: number;
  cirurgias: number;
}

export type ModoObservado = 'sim' | 'nao';

/** Resultado de uma faixa aplicada a uma classe. `valor` null = fora da tabela (PRD §5.1). */
export interface ResultadoFaixa {
  valor: number | null;
  faixa: string;
}

import type { ItemProducao } from '../types/integracao';

/**
 * Saldo de produção retida abaixo do limiar mínimo de guias (achado real 2026-08-13, regra da
 * coordenadora financeira): quando o total combinado de guias do médico numa competência é menor
 * que 5, o motor NÃO gera boleto — devolve este saldo pro orquestrador persistir
 * (`medicos_saldo_acumulado`), e ele volta como ENTRADA na competência seguinte, somado à
 * produção nova, até o total bater 5+ (aí sim gera 1 boleto só, com a soma).
 *
 * `guiasPrincipal` cobre tanto a classe HAPVIDA_CRED/NAO_CRED de um médico normal quanto o total
 * combinado (Cateter+Fístula+Angiografia+Carta de Rede) do Angiologista — os dois casos convergem
 * pra UMA classe/tabela de preço só, então um campo serve pros dois sem caso especial.
 * `valorBasePercentual` só é relevante no modo `percentual_producao`: soma de `valorCobradoOrigem`
 * retida, pra manter `base × percentual` correto ao somar com o mês que bate o limiar — não dá
 * pra somar dois VALORES FINAIS já calculados de meses diferentes (tabela por faixa e
 * base+excedente não são lineares, só a base bruta é).
 *
 * SEM campo de consultas de pediatria de propósito: consultas NUNCA ficam retidas — continuam
 * sendo cobradas todo mês em que existirem, independente do limiar de guias (mesmo
 * comportamento pré-existente de "sem guias hospitalares mas com consultas → cobra só as
 * consultas", `processarMedico`). Se o limiar de guias também retivesse consultas, um pediatra
 * que só faz consultas ambulatoriais (guias sempre 0) NUNCA mais seria cobrado — regressão real,
 * não um caso hipotético.
 */
export interface SaldoAcumulado {
  guiasPrincipal: number;
  guiasOutrosHospitais: number;
  guiasImobilizacoes: number;
  valorBasePercentual: number;
}

/** Entrada do processamento de um médico — dados já buscados (sem I/O no Engine). */
export interface EntradaProcessamentoMedico {
  medico: Pick<
    Medico,
    | 'id'
    | 'cpf'
    | 'nome'
    | 'statusHapvida'
    | 'fazOutrosHospitais'
    | 'fazImobilizacoes'
    | 'modoMudancaData'
    | 'especialidade'
    | 'modoCobranca'
    | 'percentualProducao'
    | 'regraPreco'
    | 'semExcedentePorGuia'
  >;
  itens: ItemProducao[];
  /** Guias da execução anterior do mesmo médico, p/ detecção de variação anômala (PRD §8.5). */
  historicoGuias?: number | null;
  /**
   * Itens do lote separado de consultas ambulatoriais do pediatra (Story 10.2) — vem de uma
   * produção distinta da de `itens` (guias hospitalares), NUNCA a mesma (anti-dupla-contagem).
   * Ausente/vazio = médico sem componente de consultas nesta execução (comportamento atual).
   */
  itensConsultas?: ItemProducao[];
  /**
   * Itens do lote separado de OUTROS_HOSPITAIS (Story 10.5) — produção distinta de `itens`
   * (guias normais/Hapvida). `undefined` = lote não selecionado nesta execução (o Engine gera
   * alerta e NÃO cobra a classe, nunca reaproveita a contagem de `itens`). Array presente
   * (mesmo vazio) = lote selecionado e contado normalmente.
   */
  itensOutrosHospitais?: ItemProducao[];
  /** Mesmo mecanismo acima, para o lote de IMOBILIZACOES (Story 10.5). */
  itensImobilizacoes?: ItemProducao[];
  /**
   * Itens do lote de CATETER (GATE 2026-08-07, especialidade Angiologista) — médico Angiologista
   * NÃO tem lote principal (`itens` fica vazio pra ele); a produção inteira vem de Cateter +
   * Fístula + Angiografia, cada um com regra de contagem própria (Cateter/Fístula: 1x1, sem
   * agrupamento; Angiografia: 3x1 com exceção de Intra-operatório). `undefined` = lote não
   * selecionado nesta execução (alerta, não cobra — mesmo padrão de Outros Hospitais/
   * Imobilizações). A soma das 3 guias cai na MESMA faixa HAPVIDA padrão do médico — não são
   * classes/tabelas de preço próprias.
   */
  itensCateter?: ItemProducao[];
  /** Mesmo mecanismo do Cateter acima — GATE 2026-08-07. */
  itensFistula?: ItemProducao[];
  /** Mesmo mecanismo do Cateter acima, mas com a regra 3x1 + exceção Intra-operatório em vez de
   *  1x1 — GATE 2026-08-07. */
  itensAngiografia?: ItemProducao[];
  /**
   * Quantidade de guias de Carta de Rede — GATE 2026-08-12. Diferente dos 3 lotes acima, NÃO vem
   * de itens buscados na API externa: a contagem não tem regra fixa (depende do procedimento
   * realizado no mês), então o operador informa o número diretamente. `undefined` = lote não
   * informado nesta execução (gera alerta, nunca chuta); um número (inclusive 0) = informado.
   */
  guiasCartaRede?: number | null;
  /**
   * Total de guias do lote PRINCIPAL já conferido MANUALMENTE pelo dono e importado de planilha
   * (migration 0058, aprovado 2026-09-03) — função ALTERNATIVA, usada pontualmente quando a
   * contagem automática não bateu com a conferência à mão. Vale para QUALQUER especialidade.
   *
   * `null`/`undefined` = comportamento normal (o Engine conta a produção com
   * `contarGuiasProducao`/`consolidarProducao`). Um número (inclusive 0) = o Engine PULA a
   * contagem automática do lote principal e usa este valor como `guias` e `guiasConsolidado`;
   * `cirurgias` vai a 0 (não dá pra saber quantas eram cirurgia a partir de um total agregado).
   *
   * O que NÃO muda: `itensConsultas` (consultas ambulatoriais do pediatra) continuam sendo
   * contadas normalmente — são outra fonte de dado, a planilha só substitui a contagem de GUIAS;
   * saldo acumulado, limiar mínimo, tabela de preço/faixas e lotes secundários seguem rodando
   * sobre o número resultante, seja ele automático ou manual.
   */
  guiasManuaisTotal?: number | null;
  /**
   * Motivo/observação que veio na mesma linha da planilha de `guiasManuaisTotal`. Entra no
   * ALERTA informativo do relatório interno (nunca no boleto — ver `ResultadoMedico.alertas`).
   * O Engine monta o texto do alerta para que ele seja testável isoladamente; quem chama só
   * repassa o que o operador importou.
   */
  guiasManuaisMotivo?: string | null;
  /**
   * Competência da execução (AAAA-MM) — Story 10.6. Usada SÓ para filtrar `itensOutrosHospitais`
   * pelo mês real do item (`item.data`): na origem, "Outros Hospitais" não abre uma produção por
   * mês como o lote principal, um único lote acumula vários meses. Opcional (comportamento
   * pré-10.6 preservado quando ausente) — o orquestrador real sempre a informa; testes de
   * unidade do Engine que não exercitam este filtro podem omitir.
   */
  competencia?: string;
  /**
   * Saldo de produção retida da(s) competência(s) anterior(es) (achado 2026-08-13) — o
   * orquestrador busca em `medicos_saldo_acumulado` e injeta aqui ANTES de chamar o Engine.
   * `undefined`/`null` = médico sem saldo pendente (caso comum). O Engine soma com a produção
   * desta competência e decide se bate o limiar de 5 guias ou se continua acumulando.
   */
  saldoAcumulado?: SaldoAcumulado | null;
  /**
   * Competência (AAAA-MM) em que `saldoAcumulado` começou a acumular — só pra compor o texto do
   * alerta informativo ("inclui guias acumuladas desde ..."). O Engine NUNCA decide/atualiza essa
   * competência (é o orquestrador quem sabe se está mantendo a origem antiga ou começando uma
   * nova) — por isso não faz parte de `SaldoAcumulado` nem volta em `saldoParaProximaCompetencia`.
   */
  saldoAcumuladoDesde?: string | null;
}

/** Resultado puro do Engine — sem ids de banco (preenchidos pelo orquestrador ao persistir). */
export interface ResultadoMedico {
  cpf: string;
  nome: string;
  procedimentos: number;
  cirurgias: number;
  guias: number;
  guiasConsolidado: number;
  subtotais: Subtotal[];
  totalValor: number;
  status: ExecucaoResultado['status'];
  /**
   * Avisos de conferência do resultado. Renderizados SÓ na tela de relatório interno
   * (`RelatorioGrupos`) — nunca no boleto nem em qualquer coisa que o médico/gateway veja. Por
   * isso é também o canal de AUDITORIA de números informados manualmente (`guiasManuaisTotal`,
   * migration 0058): a marca de "contagem manual" é uma linha aqui, e não um campo novo do
   * resultado, justamente para não vazar para fora do relatório.
   *
   * ATENÇÃO: `alertas` não vazio NÃO implica `status === 'alerta'`. A marca de contagem manual é
   * a única exceção (GATE do dono 2026-09-03): ela informa/audita, mas não é pendência de
   * conferência, então não bloqueia a emissão. Qualquer outro alerta continua derrubando o status.
   */
  alertas: string[];
  /**
   * Estado FINAL do saldo retido após este processamento — presente sempre que havia
   * `saldoAcumulado` de entrada OU o resultado ficou `'acumulado'`. Cada bucket é 0 se foi
   * consumido/cobrado agora, mantém o valor anterior se o lote correspondente não foi
   * selecionado nesta execução (nunca chuta — não mexe em saldo que não foi reconfirmado), ou
   * soma se ainda está abaixo do limiar. O orquestrador decide: todos os buckets em 0 → limpa a
   * linha (`limparSaldoAcumulado`); algum bucket > 0 → grava (`gravarSaldoAcumulado`).
   */
  saldoParaProximaCompetencia?: SaldoAcumulado | null;
}
