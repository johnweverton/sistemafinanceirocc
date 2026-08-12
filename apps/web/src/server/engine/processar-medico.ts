// Pipeline principal do motor — porte 1:1 de motor_guias_v2.py (processar_medico).
// Função pura: recebe médico + procedimentos já buscados, devolve resultado agregado.
// NÃO faz I/O (sem Supabase, sem fetch) — Coding Standard "Engine sem I/O".
import type {
  EntradaProcessamentoMedico,
  ResultadoMedico,
  TabelaPreco,
  Subtotal,
  Classe,
  ItemProducao,
} from '@cobranca/shared';
import {
  itensValidos,
  contarGuiasProducao,
  consolidarProducao,
  detectarModoProducao,
  contarConsultasProducao,
  isPediatra,
  isAngiologista,
  filtrarPorCompetencia,
} from './contagem-producao';
import { checar } from './conferencia';
import {
  classesDoMedico,
  valorDaFaixa,
  tabelaSemExcedentePorGuia,
  TABELA_PRECO_PADRAO,
  VALOR_CONSULTA_PEDIATRIA_PADRAO,
} from './precos';
import { aplicarRegraPreco } from './regra-preco';

/**
 * Processa um médico de ponta a ponta (PRD §8.3):
 *   1. valida linhas (PRD §5.6)
 *   2. conta guias e cirurgias (PRD §5.2)
 *   3. roda a trava de conferência (PRD §5.3, §5.6, §8.5)
 *   4. aplica a tabela de preço por classe e soma (PRD §5.1, §5.5)
 *
 * Sem procedimentos válidos → status 'sem_dados' (PRD §5.6).
 * Alertas de negócio são VALORES retornados, não exceções (Coding Standard).
 */
export function processarMedico(
  entrada: EntradaProcessamentoMedico,
  tabela: TabelaPreco = TABELA_PRECO_PADRAO,
  valorConsultaPediatria: number = VALOR_CONSULTA_PEDIATRIA_PADRAO,
): ResultadoMedico {
  const {
    medico,
    itens,
    historicoGuias,
    itensConsultas,
    itensOutrosHospitais,
    itensImobilizacoes,
    itensCateter,
    itensFistula,
    itensAngiografia,
    guiasCartaRede,
    competencia,
  } = entrada;

  // Angiologista NÃO tem lote principal (GATE 2026-08-07) — a produção inteira vem de Cateter
  // (1x1) + Fístula (1x1) + Angiografia (3x1 + exceção Intra-operatório) + Carta de Rede (manual,
  // GATE 2026-08-12). Desvia ANTES do fluxo normal baseado em `itens`, que fica sempre vazio pra
  // essa especialidade.
  if (isAngiologista(medico.especialidade)) {
    return processarAngiologista(
      medico,
      { itensCateter, itensFistula, itensAngiografia, guiasCartaRede: guiasCartaRede ?? undefined },
      tabela,
    );
  }

  const { validos } = itensValidos(itens);
  const consultasValidas = itensConsultas ? itensValidos(itensConsultas).validos : [];

  if (validos.length === 0) {
    // Story 10.2: pediatra sem guias hospitalares na competência, mas COM consultas
    // ambulatoriais (lote separado) — cobra só o componente de consultas, em vez de cair em
    // 'sem_dados' e perder o valor silenciosamente (PRD §2, nunca chuta E nunca perde valor).
    if (isPediatra(medico.especialidade) && consultasValidas.length > 0) {
      const nConsultas = consultasValidas.length;
      const valorConsultas = nConsultas * valorConsultaPediatria;
      return {
        cpf: medico.cpf ?? '',
        nome: medico.nome,
        procedimentos: 0,
        cirurgias: 0,
        guias: 0,
        guiasConsolidado: 0,
        subtotais: [
          {
            classe: 'CONSULTA_PEDIATRIA',
            guias: nConsultas,
            valor: valorConsultas,
            faixa: `${nConsultas} consultas × R$${valorConsultaPediatria.toFixed(2)}`,
          },
        ],
        totalValor: valorConsultas,
        status: 'ok',
        alertas: [],
      };
    }
    return {
      cpf: medico.cpf ?? '', // snapshot informativo — médico importado pode não ter CPF (Épico 5 §3.4)
      nome: medico.nome,
      procedimentos: 0, // mapeia itens totais? PRD original usava length validos, let's keep it 0.
      cirurgias: 0,
      guias: 0,
      guiasConsolidado: 0,
      subtotais: [],
      totalValor: 0,
      status: 'sem_dados',
      alertas: ['Nenhum procedimento encontrado para essa competência.'],
    };
  }

  const { guias, cirurgias } = contarGuiasProducao(validos, medico.especialidade);
  const guiasConsolidado = consolidarProducao(validos, medico.especialidade);
  const modoObservado = detectarModoProducao(validos);
  const alertas = checar(validos, medico.modoMudancaData, guias, historicoGuias, medico.especialidade, modoObservado);

  const subtotais: Subtotal[] = [];
  let totalValor = 0;

  if (medico.modoCobranca === 'percentual_producao') {
    // Story 6.2 — percentual × valor COBRADO da produção (GATE do dono 2026-07-08):
    // base = Σ valorCobradoOrigem dos itens VÁLIDOS (glosados ENTRAM — status nunca filtra,
    // decisão 5 do Épico 5). Contagem e trava de conferência acima seguem rodando: são
    // diagnóstico, não preço. O sistema NUNCA chuta (PRD §2) — base incompleta vira alerta.
    const percentual = medico.percentualProducao ?? 0;
    let base = 0;
    let itensSemValor = 0;
    for (const item of validos) {
      if (item.valorCobradoOrigem != null) base += item.valorCobradoOrigem;
      else itensSemValor++;
    }

    if (percentual <= 0) {
      alertas.push(
        'Modo percentual sem percentual configurado: valor zerado, corrigir cadastro do médico.',
      );
    }
    if (itensSemValor > 0) {
      alertas.push(
        `${itensSemValor} item(ns) sem valor cobrado na origem: base do percentual SUBCONTADA, verificar.`,
      );
    }
    if (base <= 0) {
      alertas.push('Base de produção zerada: nenhum valor cobrado na origem, verificar.');
    }

    // Arredonda para centavos: base × (percentual/100) com 2 casas.
    totalValor = Math.round(base * percentual) / 100;
    subtotais.push({
      classe: 'PERCENTUAL_PRODUCAO',
      guias,
      valor: totalValor,
      faixa: `${percentual}% × R$${base.toFixed(2)} (produção cobrada)`,
    });
  } else if (medico.modoCobranca === 'preco_proprio') {
    // Story 10.1 — GATE do dono (2026-07-20): preço negociado fora da tabela de faixas
    // (Dr. Ezequiel, Jansen, Nelson, Carlos Batista, Jefferson). Contagem e trava de
    // conferência acima seguem rodando: são diagnóstico, não preço. `aplicarRegraPreco`
    // (extraída na Story 10.4b) nunca chuta valor — regra ausente/incompleta vira alerta.
    const resultado = aplicarRegraPreco(medico.regraPreco, guias);
    totalValor = resultado.valor;
    alertas.push(...resultado.alertas);
    if (resultado.alertas.length === 0) {
      subtotais.push({ classe: 'PRECO_PROPRIO', guias, valor: resultado.valor, faixa: resultado.subtotalFaixa });
    }
  } else {
    // Story 10.5 — OUTROS_HOSPITAIS/IMOBILIZACOES vêm de um LOTE SEPARADO (produção distinta na
    // origem, mesmo padrão do lote de consultas do pediatra — Story 10.2), com contagem e tabela
    // de preço PRÓPRIAS. Antes desta story o motor reaproveitava a MESMA `guias` (do lote
    // principal) para TODAS as classes do médico — cobrando a mesma produção 2x em tabelas
    // diferentes (bug real: Dr. Marcel Rolim Queiroz — 50 guias do lote principal aplicadas
    // tanto em HAPVIDA_CRED quanto em OUTROS_HOSPITAIS, em vez de 42 Hapvida + 19 Outros
    // Hospitais, cada um na sua própria tabela). Nunca chuta (PRD §2): se o médico está
    // configurado para a classe mas o lote separado não foi selecionado nesta execução, vira
    // alerta explícito em vez de reaproveitar a contagem do lote principal.
    const guiasPorLoteSecundario: Partial<Record<Classe, number>> = {};
    if (medico.fazOutrosHospitais) {
      if (itensOutrosHospitais !== undefined) {
        // Story 10.6: na origem, o lote de Outros Hospitais não abre uma produção por mês como
        // o lote principal — um único lote acumula vários meses. Filtra pela competência da
        // execução antes de contar (nunca chuta: itens de outro mês NÃO entram na contagem, e
        // vira alerta informativo em vez de descarte silencioso). Sem `competencia` informada
        // (testes de unidade do Engine), preserva o comportamento anterior à Story 10.6.
        const { itensDaCompetencia, ignoradosPorCompetencia } = competencia
          ? filtrarPorCompetencia(itensOutrosHospitais, competencia)
          : { itensDaCompetencia: itensOutrosHospitais, ignoradosPorCompetencia: 0 };
        guiasPorLoteSecundario.OUTROS_HOSPITAIS = contarGuiasProducao(
          itensDaCompetencia,
          medico.especialidade,
        ).guias;
        if (ignoradosPorCompetencia > 0) {
          alertas.push(
            `${ignoradosPorCompetencia} item(ns) do lote de Outros Hospitais são de outra ` +
              'competência (mês diferente do desta execução) e foram ignorados na contagem.',
          );
        }
      } else {
        alertas.push(
          'Médico faz Outros Hospitais mas o lote separado de produção não foi selecionado nesta execução. Guias de Outros Hospitais NÃO cobradas, selecionar a produção correspondente.',
        );
      }
    }
    if (medico.fazImobilizacoes) {
      if (itensImobilizacoes !== undefined) {
        guiasPorLoteSecundario.IMOBILIZACOES = contarGuiasProducao(
          itensImobilizacoes,
          medico.especialidade,
        ).guias;
      } else {
        alertas.push(
          'Médico faz Imobilizações mas o lote separado de produção não foi selecionado nesta execução. Guias de Imobilizações NÃO cobradas, selecionar a produção correspondente.',
        );
      }
    }

    for (const classe of classesDoMedico(medico)) {
      const ehClasseSecundaria = classe === 'OUTROS_HOSPITAIS' || classe === 'IMOBILIZACOES';
      const guiasClasse = ehClasseSecundaria ? guiasPorLoteSecundario[classe] : guias;
      if (guiasClasse == null) {
        // Lote separado não informado (alerta já registrado acima) — nunca chuta valor.
        continue;
      }
      // Story 10.7: contrato antigo sem excedente por guia (Dr. Adilson) — mesma tabela/faixas
      // de todo mundo, só capa no teto da última faixa em vez de somar por guia acima dele.
      const tabelaClasse = medico.semExcedentePorGuia
        ? tabelaSemExcedentePorGuia(tabela[classe])
        : tabela[classe];
      const { valor, faixa } = valorDaFaixa(tabelaClasse, guiasClasse);
      subtotais.push({ classe, guias: guiasClasse, valor: valor ?? 0, faixa });
      totalValor += valor ?? 0;
      // valor null = fora da tabela (PRD §11 outros hospitais > 80) → vira alerta, não chuta.
      if (valor == null) {
        alertas.push(
          `Classe ${classe} com ${guiasClasse} guias está FORA DA TABELA: faixa não definida, verificar.`,
        );
      }
    }
  }

  // Story 10.2: componente ADITIVO de consultas ambulatoriais do pediatra — soma ao valor de
  // guias já calculado acima (qualquer que seja o modo), nunca substitui. Lote separado
  // (`itensConsultas`) nunca é o mesmo array de `itens` — anti-dupla-contagem por construção.
  if (isPediatra(medico.especialidade) && consultasValidas.length > 0) {
    const nConsultas = consultasValidas.length;
    const valorConsultas = nConsultas * valorConsultaPediatria;
    totalValor += valorConsultas;
    subtotais.push({
      classe: 'CONSULTA_PEDIATRIA',
      guias: nConsultas,
      valor: valorConsultas,
      faixa: `${nConsultas} consultas × R$${valorConsultaPediatria.toFixed(2)}`,
    });
  }

  return {
    cpf: medico.cpf ?? '',
    nome: medico.nome,
    procedimentos: validos.length,
    cirurgias,
    guias,
    guiasConsolidado,
    subtotais,
    totalValor,
    status: alertas.length > 0 ? 'alerta' : 'ok',
    alertas,
  };
}

/**
 * Processa um médico Angiologista (GATE 2026-08-07) — especialidade SEM lote principal, a
 * produção inteira vem de 4 lotes próprios, cada um com regra de contagem diferente:
 *   - Cateter: 1x1 — cada item válido é 1 guia, SEM agrupamento (é um "pacote" por natureza,
 *     não guias hospitalares soltas que fariam sentido bundlar 3x1).
 *   - Fístula: mesmo mecanismo do Cateter.
 *   - Angiografia: 3x1 (teto(n/3)) com exceção — Intra-operatório (`CODIGOS_EXCECAO_ANGIOGRAFIA`)
 *     nunca entra no pool, cada ocorrência é 1 guia individual. Reusa `contarGuiasProducao`
 *     passando a especialidade do médico (que já ativa esse comportamento via `usaRegra3x1`/
 *     `ehExcecao`) — mesma função usada por todo mundo, não uma regra paralela.
 *   - Carta de Rede (GATE 2026-08-12): SEM regra de contagem automática — confirmado pela
 *     coordenadora, a contagem depende de qual procedimento foi realizado naquele mês, "foge de
 *     um padrão". Por isso não busca itens da API externa: o operador informa `guiasCartaRede`
 *     manualmente (via `execucao_selecoes.carta_rede_guias`), e o motor só soma o número recebido.
 * As 4 guias SOMADAS caem numa faixa ÚNICA da tabela HAPVIDA padrão do médico (crédito/não
 * credenciado) — confirmado pelo dono: não são classes/tabelas de preço próprias, só fontes de
 * dados com regra de CONTAGEM diferente. Lote não selecionado/informado nesta execução → alerta
 * explícito (nunca chuta, mesmo padrão de Outros Hospitais/Imobilizações) e 0 guias daquele lote —
 * nunca reaproveita a contagem de outro lote.
 */
function processarAngiologista(
  medico: EntradaProcessamentoMedico['medico'],
  lotes: {
    itensCateter?: ItemProducao[];
    itensFistula?: ItemProducao[];
    itensAngiografia?: ItemProducao[];
    guiasCartaRede?: number;
  },
  tabela: TabelaPreco,
): ResultadoMedico {
  const alertas: string[] = [];

  let guiasCateter = 0;
  let procedimentosCateter = 0;
  if (lotes.itensCateter !== undefined) {
    procedimentosCateter = itensValidos(lotes.itensCateter).validos.length;
    guiasCateter = procedimentosCateter; // 1x1 — sem agrupamento
  } else {
    alertas.push(
      'Médico Angiologista, mas o lote de Cateter não foi selecionado nesta execução. Guias de Cateter NÃO cobradas, selecionar a produção correspondente.',
    );
  }

  let guiasFistula = 0;
  let procedimentosFistula = 0;
  if (lotes.itensFistula !== undefined) {
    procedimentosFistula = itensValidos(lotes.itensFistula).validos.length;
    guiasFistula = procedimentosFistula; // 1x1 — sem agrupamento
  } else {
    alertas.push(
      'Médico Angiologista, mas o lote de Fístula não foi selecionado nesta execução. Guias de Fístula NÃO cobradas, selecionar a produção correspondente.',
    );
  }

  let guiasAngiografia = 0;
  let cirurgiasAngiografia = 0;
  let consolidadoAngiografia = 0;
  let procedimentosAngiografia = 0;
  if (lotes.itensAngiografia !== undefined) {
    procedimentosAngiografia = itensValidos(lotes.itensAngiografia).validos.length;
    const r = contarGuiasProducao(lotes.itensAngiografia, medico.especialidade);
    guiasAngiografia = r.guias;
    cirurgiasAngiografia = r.cirurgias;
    consolidadoAngiografia = consolidarProducao(lotes.itensAngiografia, medico.especialidade);
  } else {
    alertas.push(
      'Médico Angiologista, mas o lote de Angiografia não foi selecionado nesta execução. Guias de Angiografia NÃO cobradas, selecionar a produção correspondente.',
    );
  }

  let guiasCartaRede = 0;
  if (lotes.guiasCartaRede !== undefined) {
    guiasCartaRede = lotes.guiasCartaRede; // contagem manual — sem fórmula, informada pelo operador
  } else {
    alertas.push(
      'Médico Angiologista, mas a Carta de Rede não foi informada nesta execução. Guias de Carta de Rede NÃO cobradas, informar a quantidade manualmente.',
    );
  }

  const guias = guiasCateter + guiasFistula + guiasAngiografia + guiasCartaRede;
  const cirurgias = guiasCateter + guiasFistula + cirurgiasAngiografia;
  const guiasConsolidado = guiasCateter + guiasFistula + consolidadoAngiografia + guiasCartaRede;
  const procedimentos = procedimentosCateter + procedimentosFistula + procedimentosAngiografia + guiasCartaRede;

  if (guias === 0) {
    return {
      cpf: medico.cpf ?? '',
      nome: medico.nome,
      procedimentos,
      cirurgias,
      guias: 0,
      guiasConsolidado: 0,
      subtotais: [],
      totalValor: 0,
      status: alertas.length > 0 ? 'alerta' : 'sem_dados',
      alertas: alertas.length > 0 ? alertas : ['Nenhum procedimento encontrado para essa competência.'],
    };
  }

  // Tabela padrão (crédito/não credenciado) — mesma classe/faixa que qualquer outro médico
  // usaria pro lote principal. Angiologista não tem classe/tabela própria (confirmado pelo dono).
  const classe: Classe = medico.statusHapvida === 'credenciado' ? 'HAPVIDA_CRED' : 'HAPVIDA_NAO_CRED';
  const tabelaClasse = medico.semExcedentePorGuia ? tabelaSemExcedentePorGuia(tabela[classe]) : tabela[classe];
  const { valor, faixa } = valorDaFaixa(tabelaClasse, guias);
  if (valor == null) {
    alertas.push(`Classe ${classe} com ${guias} guias está FORA DA TABELA: faixa não definida, verificar.`);
  }

  // Anota na memória de cálculo (faixa) quando a soma inclui guias digitadas manualmente — igual
  // ao princípio de nunca esconder de onde veio um número (GATE 2026-08-12).
  const faixaAnotada =
    guiasCartaRede > 0 ? `${faixa} (inclui ${guiasCartaRede} guia(s) de Carta de Rede informada(s) manualmente)` : faixa;

  return {
    cpf: medico.cpf ?? '',
    nome: medico.nome,
    procedimentos,
    cirurgias,
    guias,
    guiasConsolidado,
    subtotais: [{ classe, guias, valor: valor ?? 0, faixa: faixaAnotada }],
    totalValor: valor ?? 0,
    status: alertas.length > 0 ? 'alerta' : 'ok',
    alertas,
  };
}
