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
  SaldoAcumulado,
} from '@cobranca/shared';
import {
  itensValidos,
  contarGuiasProducao,
  consolidarProducao,
  detectarModoProducao,
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
 * Limiar mínimo de guias combinadas pra gerar boleto (achado real 2026-08-13, regra da
 * coordenadora financeira) — abaixo disso, a produção fica retida em vez de virar boleto. Ver
 * `SaldoAcumulado` (engine-contracts) pro desenho completo de como o saldo atravessa competências.
 */
const LIMIAR_MINIMO_GUIAS = 5;

/**
 * Prefixo do alerta de auditoria da contagem manual por planilha (migration 0058).
 *
 * GATE do dono (2026-09-03): este é o ÚNICO alerta que NÃO derruba o status para 'alerta'. Todos
 * os outros são achados de CONFERÊNCIA (dado incompleto, variação anômala, lote não selecionado)
 * — coisas que o motor não soube resolver e que pedem olho humano antes de virar boleto. A marca
 * de contagem manual é o oposto disso: o número JÁ foi conferido à mão pelo dono, é a versão mais
 * confiável que existe. Deixá-la derrubar o status obrigaria o operador a passar cada médico da
 * planilha pelo "Revisar e liberar" (emissão exige status 'ok', ver `validarResultadoParaEmissao`)
 * — atrito puro sobre um dado que já nasceu conferido.
 *
 * O alerta continua no array `alertas` (rastro no relatório interno, nunca no boleto); só não
 * conta para o status. Se houver QUALQUER outro alerta junto (ex.: VARIAÇÃO ALTA contra o mês
 * anterior), o status vira 'alerta' normalmente — a checagem de sanidade não é enfraquecida.
 */
export const PREFIXO_ALERTA_CONTAGEM_MANUAL = 'CONTAGEM MANUAL (planilha):';

/** Saldo "vazio" — usado quando `entrada.saldoAcumulado` é null/undefined (médico sem retenção). */
const SALDO_VAZIO: SaldoAcumulado = {
  guiasPrincipal: 0,
  guiasOutrosHospitais: 0,
  guiasImobilizacoes: 0,
  valorBasePercentual: 0,
};

/**
 * Processa um médico de ponta a ponta (PRD §8.3):
 *   1. valida linhas (PRD §5.6)
 *   2. conta guias e cirurgias (PRD §5.2) — ou usa `guiasManuaisTotal` no lugar da contagem
 *      automática, quando o total daquele médico veio conferido à mão numa planilha (0058)
 *   3. roda a trava de conferência (PRD §5.3, §5.6, §8.5)
 *   4. combina com saldo retido de competências anteriores (achado 2026-08-13) e decide se bate o
 *      limiar mínimo de guias — se não bater, retém tudo de novo em vez de gerar boleto
 *   5. aplica a tabela de preço por classe e soma (PRD §5.1, §5.5)
 *
 * Sem procedimentos válidos E sem saldo retido → status 'sem_dados' (PRD §5.6). Alertas de
 * negócio são VALORES retornados, não exceções (Coding Standard).
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
    guiasManuaisTotal,
    guiasManuaisMotivo,
    competencia,
    saldoAcumulado,
    saldoAcumuladoDesde,
  } = entrada;

  /**
   * Contagem manual por planilha (migration 0058, aprovado 2026-09-03): para ESTE médico nesta
   * competência, o total de guias do lote principal já foi conferido à mão pelo dono — o motor
   * pula `contarGuiasProducao`/`consolidarProducao` e usa o número informado. Função alternativa,
   * usada pontualmente quando a contagem automática não bateu; quem não vem na planilha continua
   * 100% no fluxo automático na MESMA execução (execução mista é o caso normal).
   */
  const contagemManual = guiasManuaisTotal != null;

  // Angiologista NÃO tem lote principal (GATE 2026-08-07) — a produção inteira vem de Cateter
  // (1x1) + Fístula (1x1) + Angiografia (3x1 + exceção Intra-operatório) + Carta de Rede (manual,
  // GATE 2026-08-12). Desvia ANTES do fluxo normal baseado em `itens`, que fica sempre vazio pra
  // essa especialidade.
  if (isAngiologista(medico.especialidade)) {
    return processarAngiologista(
      medico,
      { itensCateter, itensFistula, itensAngiografia, guiasCartaRede: guiasCartaRede ?? undefined },
      tabela,
      saldoAcumulado,
      saldoAcumuladoDesde,
    );
  }

  const { validos, invalidos } = itensValidos(itens);
  const consultasValidas = itensConsultas ? itensValidos(itensConsultas).validos : [];
  // Achado 2026-09-02: `itensValidos` já separava os inválidos (sem data ou sem paciente), mas o
  // pipeline descartava em silêncio — o guia do sistema promete "descartadas E reportadas", e sem
  // isso uma origem com linhas quebradas subconta guias sem deixar rastro pro operador.
  const alertasDescarte =
    invalidos.length > 0
      ? [`${invalidos.length} item(ns) sem paciente ou data foram descartados da contagem — verificar na origem.`]
      : [];
  const nConsultas = consultasValidas.length;
  const valorConsultas = nConsultas * valorConsultaPediatria;
  // Consultas NUNCA ficam retidas pelo limiar de guias (ver doc de `SaldoAcumulado`) — sempre que
  // existirem, bilham no mesmo mês, mesmo que as guias hospitalares estejam sendo acumuladas.
  const subtotalConsultas: Subtotal | null =
    isPediatra(medico.especialidade) && nConsultas > 0
      ? {
          classe: 'CONSULTA_PEDIATRIA',
          guias: nConsultas,
          valor: valorConsultas,
          faixa: `${nConsultas} consultas × R$${valorConsultaPediatria.toFixed(2)}`,
        }
      : null;

  const s = saldoAcumulado ?? SALDO_VAZIO;
  const temSaldoAnterior =
    s.guiasPrincipal > 0 || s.guiasOutrosHospitais > 0 || s.guiasImobilizacoes > 0 || s.valorBasePercentual > 0;

  // `contagemManual` conta como "tem dado": o número da planilha existe INDEPENDENTE de a
  // produção da origem ter itens válidos (é justamente o caso de uso — a contagem automática não
  // bateu). Sem esta guarda, um médico com total manual e produção vazia cairia em 'sem_dados' e
  // o número conferido à mão seria descartado em silêncio.
  if (validos.length === 0 && !temSaldoAnterior && !contagemManual) {
    // Story 10.2: pediatra sem guias hospitalares na competência, mas COM consultas
    // ambulatoriais (lote separado) — cobra só o componente de consultas, em vez de cair em
    // 'sem_dados' e perder o valor silenciosamente (PRD §2, nunca chuta E nunca perde valor).
    if (subtotalConsultas) {
      return {
        cpf: medico.cpf ?? '',
        nome: medico.nome,
        procedimentos: 0,
        cirurgias: 0,
        guias: 0,
        guiasConsolidado: 0,
        subtotais: [subtotalConsultas],
        totalValor: valorConsultas,
        status: alertasDescarte.length > 0 ? 'alerta' : 'ok',
        alertas: alertasDescarte,
      };
    }
    return {
      cpf: medico.cpf ?? '', // snapshot informativo — médico importado pode não ter CPF (Épico 5 §3.4)
      nome: medico.nome,
      procedimentos: 0,
      cirurgias: 0,
      guias: 0,
      guiasConsolidado: 0,
      subtotais: [],
      totalValor: 0,
      status: 'sem_dados',
      alertas: ['Nenhum procedimento encontrado para essa competência.', ...alertasDescarte],
    };
  }

  // Contagem manual (migration 0058) substitui SÓ a contagem de guias do lote principal:
  //  - `cirurgias` vai a 0 — um total agregado digitado não diz quantas eram cirurgia;
  //  - `guiasConsolidado` recebe o mesmo número — não existe distinção consolidado/não-consolidado
  //    num número único informado à mão (o consolidado é um reagrupamento da produção, e aqui não
  //    há produção sendo agrupada);
  //  - `modoObservado` fica `undefined` — a trava de MODO INCONSISTENTE conferia como a contagem
  //    AUTOMÁTICA agrupou os itens; sem contagem automática ela não teria o que conferir, e
  //    dispararia ruído sobre um número que não veio daqueles itens.
  const { guias, cirurgias } = contagemManual
    ? { guias: guiasManuaisTotal!, cirurgias: 0 }
    : contarGuiasProducao(validos, medico.especialidade);
  const guiasConsolidado = contagemManual ? guiasManuaisTotal! : consolidarProducao(validos, medico.especialidade);
  const modoObservado = contagemManual ? undefined : detectarModoProducao(validos);
  // Compara SEMPRE a produção BRUTA deste mês (não o total combinado com saldo) contra o
  // histórico — é o número comparável a uma competência normal. `historicoGuias` (guiasExecucaoAnterior)
  // já exclui resultados 'acumulado' (não é produção real comparável), mas pode refletir um total
  // JÁ COMBINADO de um mês que consumiu saldo — limitação conhecida, aceitável (é só um alerta
  // informativo, nunca bloqueia).
  //
  // `checar` continua rodando com o número manual de propósito: o alerta de VARIAÇÃO ALTA contra o
  // mês anterior é uma checagem de sanidade que vale AINDA MAIS pra um número digitado à mão.
  const alertas = [
    ...alertasDescarte,
    ...checar(validos, medico.modoMudancaData, guias, historicoGuias, medico.especialidade, modoObservado),
  ];
  // Auditoria da contagem manual (aprovado 2026-09-03): entra no array de `alertas`, que é
  // renderizado SÓ no relatório interno — nunca no boleto, nunca visível ao médico/Cora. Vai na
  // PRIMEIRA posição porque a visão resumida do relatório mostra apenas `alertas[0]`, e "este
  // número não veio do motor" é a informação que o operador não pode deixar de ver.
  if (contagemManual) {
    alertas.unshift(
      `${PREFIXO_ALERTA_CONTAGEM_MANUAL} ${guiasManuaisTotal} guia(s) informada(s) manualmente. ` +
        `Motivo: ${guiasManuaisMotivo?.trim() || 'não informado'}`,
    );
  }

  // Lotes secundários (Outros Hospitais/Imobilizações) — só no modo faixa_guias (mesmo escopo de
  // sempre: percentual_producao/preco_proprio nunca cruzaram com essas classes, Story 10.5).
  const ehFaixaGuias = medico.modoCobranca !== 'percentual_producao' && medico.modoCobranca !== 'preco_proprio';
  let guiasOutrosHospitaisEsteMes: number | undefined;
  let guiasImobilizacoesEsteMes: number | undefined;
  if (ehFaixaGuias) {
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
        guiasOutrosHospitaisEsteMes = contarGuiasProducao(itensDaCompetencia, medico.especialidade).guias;
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
        guiasImobilizacoesEsteMes = contarGuiasProducao(itensImobilizacoes, medico.especialidade).guias;
      } else {
        alertas.push(
          'Médico faz Imobilizações mas o lote separado de produção não foi selecionado nesta execução. Guias de Imobilizações NÃO cobradas, selecionar a produção correspondente.',
        );
      }
    }
  }

  // Base do percentual (este mês) — Story 6.2, GATE do dono 2026-07-08: percentual × valor
  // COBRADO da produção. Base = Σ valorCobradoOrigem dos itens VÁLIDOS (glosados ENTRAM — status
  // nunca filtra, decisão 5 do Épico 5).
  let baseEsteMes = 0;
  let itensSemValor = 0;
  if (medico.modoCobranca === 'percentual_producao') {
    for (const item of validos) {
      if (item.valorCobradoOrigem != null) baseEsteMes += item.valorCobradoOrigem;
      else itensSemValor++;
    }
  }

  // --- Combina com o saldo retido (achado 2026-08-13) ---
  // "Ativo" = o lote foi de fato selecionado/computado nesta execução. Se não foi (undefined),
  // qualquer saldo daquele bucket fica INTOCADO — nunca chuta um número que não foi reconfirmado
  // nesta competência, mesmo que o resto do médico esteja sendo cobrado agora.
  const guiasPrincipalTotal = guias + s.guiasPrincipal;
  const outrosHospitaisAtivo = guiasOutrosHospitaisEsteMes !== undefined;
  const guiasOutrosHospitaisTotal = outrosHospitaisAtivo ? guiasOutrosHospitaisEsteMes! + s.guiasOutrosHospitais : undefined;
  const imobilizacoesAtivo = guiasImobilizacoesEsteMes !== undefined;
  const guiasImobilizacoesTotal = imobilizacoesAtivo ? guiasImobilizacoesEsteMes! + s.guiasImobilizacoes : undefined;
  const valorBasePercentualTotal = baseEsteMes + s.valorBasePercentual;

  // Limiar considera só os buckets ATIVOS desta execução — um saldo intocado de um lote não
  // selecionado não conta pra decidir SE cobra os demais buckets agora.
  const guiasParaLimiar = guiasPrincipalTotal + (guiasOutrosHospitaisTotal ?? 0) + (guiasImobilizacoesTotal ?? 0);
  const guiasAcumuladasAntes =
    s.guiasPrincipal + (outrosHospitaisAtivo ? s.guiasOutrosHospitais : 0) + (imobilizacoesAtivo ? s.guiasImobilizacoes : 0);

  if (guiasParaLimiar < LIMIAR_MINIMO_GUIAS) {
    const saldoNovo: SaldoAcumulado = {
      guiasPrincipal: guiasPrincipalTotal,
      guiasOutrosHospitais: outrosHospitaisAtivo ? guiasOutrosHospitaisTotal! : s.guiasOutrosHospitais,
      guiasImobilizacoes: imobilizacoesAtivo ? guiasImobilizacoesTotal! : s.guiasImobilizacoes,
      valorBasePercentual: medico.modoCobranca === 'percentual_producao' ? valorBasePercentualTotal : s.valorBasePercentual,
    };
    const alertaAcumulo =
      `${guiasParaLimiar} guia(s) combinada(s) abaixo do mínimo de ${LIMIAR_MINIMO_GUIAS} — produção acumulada, ` +
      `aguardando o próximo mês em que o médico for processado` +
      (saldoAcumuladoDesde ? ` (acumulando desde ${saldoAcumuladoDesde})` : '') +
      '.';

    if (subtotalConsultas) {
      return {
        cpf: medico.cpf ?? '',
        nome: medico.nome,
        procedimentos: validos.length,
        cirurgias,
        guias: guiasParaLimiar,
        guiasConsolidado,
        subtotais: [subtotalConsultas],
        totalValor: valorConsultas,
        status: 'ok',
        alertas: [...alertas, alertaAcumulo],
        saldoParaProximaCompetencia: saldoNovo,
      };
    }
    return {
      cpf: medico.cpf ?? '',
      nome: medico.nome,
      procedimentos: validos.length,
      cirurgias,
      guias: guiasParaLimiar,
      guiasConsolidado,
      subtotais: [],
      totalValor: 0,
      status: 'acumulado',
      alertas: [...alertas, alertaAcumulo],
      saldoParaProximaCompetencia: saldoNovo,
    };
  }

  // --- Bate o limiar: cobra normalmente, com os totais COMBINADOS (este mês + saldo) ---
  const notaAcumulo =
    guiasAcumuladasAntes > 0
      ? ` — inclui ${guiasAcumuladasAntes} guia(s) acumulada(s)${saldoAcumuladoDesde ? ` desde ${saldoAcumuladoDesde}` : ''}`
      : '';

  const subtotais: Subtotal[] = [];
  let totalValor = 0;

  if (medico.modoCobranca === 'percentual_producao') {
    const percentual = medico.percentualProducao ?? 0;
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
    if (valorBasePercentualTotal <= 0) {
      alertas.push('Base de produção zerada: nenhum valor cobrado na origem, verificar.');
    }

    // Arredonda para centavos: base × (percentual/100) com 2 casas.
    totalValor = Math.round(valorBasePercentualTotal * percentual) / 100;
    subtotais.push({
      classe: 'PERCENTUAL_PRODUCAO',
      guias: guiasPrincipalTotal,
      valor: totalValor,
      faixa: `${percentual}% × R$${valorBasePercentualTotal.toFixed(2)} (produção cobrada)${notaAcumulo}`,
    });
  } else if (medico.modoCobranca === 'preco_proprio') {
    // Story 10.1 — GATE do dono (2026-07-20): preço negociado fora da tabela de faixas
    // (Dr. Ezequiel, Jansen, Nelson, Carlos Batista, Jefferson). `aplicarRegraPreco` nunca chuta
    // valor — regra ausente/incompleta vira alerta. Forma 'fixo': o valor não muda com o
    // acúmulo, só o MOMENTO de cobrar (GATE 2026-08-13) — `aplicarRegraPreco` já ignora
    // `quantidade` nessa forma, então basta ter chegado até aqui (limiar batido).
    const resultado = aplicarRegraPreco(medico.regraPreco, guiasPrincipalTotal);
    totalValor = resultado.valor;
    alertas.push(...resultado.alertas);
    if (resultado.alertas.length === 0) {
      subtotais.push({
        classe: 'PRECO_PROPRIO',
        guias: guiasPrincipalTotal,
        valor: resultado.valor,
        faixa: `${resultado.subtotalFaixa}${notaAcumulo}`,
      });
    }
  } else {
    // Story 10.5 — OUTROS_HOSPITAIS/IMOBILIZACOES vêm de um LOTE SEPARADO, com contagem e tabela
    // de preço PRÓPRIAS. Nunca chuta (PRD §2): se o médico está configurado para a classe mas o
    // lote separado não foi selecionado nesta execução, vira alerta explícito (já registrado
    // acima) em vez de reaproveitar a contagem do lote principal.
    const guiasPorLoteSecundario: Partial<Record<Classe, number>> = {};
    if (outrosHospitaisAtivo) guiasPorLoteSecundario.OUTROS_HOSPITAIS = guiasOutrosHospitaisTotal!;
    if (imobilizacoesAtivo) guiasPorLoteSecundario.IMOBILIZACOES = guiasImobilizacoesTotal!;

    for (const classe of classesDoMedico(medico)) {
      const ehClasseSecundaria = classe === 'OUTROS_HOSPITAIS' || classe === 'IMOBILIZACOES';
      const guiasClasse = ehClasseSecundaria ? guiasPorLoteSecundario[classe] : guiasPrincipalTotal;
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
      subtotais.push({ classe, guias: guiasClasse, valor: valor ?? 0, faixa: `${faixa}${notaAcumulo}` });
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
  // guias já calculado acima (qualquer que seja o modo), nunca substitui.
  if (subtotalConsultas) {
    totalValor += valorConsultas;
    subtotais.push(subtotalConsultas);
  }

  // Saldo consumido: buckets ativos zeram (cobrados agora); buckets não tocados nesta execução
  // (lote não selecionado) preservam o valor anterior — não some com o resto só porque o médico
  // bateu o limiar em OUTRO bucket.
  const saldoFinal: SaldoAcumulado = {
    guiasPrincipal: 0,
    guiasOutrosHospitais: outrosHospitaisAtivo ? 0 : s.guiasOutrosHospitais,
    guiasImobilizacoes: imobilizacoesAtivo ? 0 : s.guiasImobilizacoes,
    valorBasePercentual: medico.modoCobranca === 'percentual_producao' ? 0 : s.valorBasePercentual,
  };

  // A marca de contagem manual é auditoria, não pendência de conferência — não derruba o status
  // (GATE do dono 2026-09-03, ver PREFIXO_ALERTA_CONTAGEM_MANUAL). Qualquer OUTRO alerta continua
  // valendo normalmente, inclusive quando aparece junto com ela.
  const alertasDeConferencia = alertas.filter((a) => !a.startsWith(PREFIXO_ALERTA_CONTAGEM_MANUAL));

  return {
    cpf: medico.cpf ?? '',
    nome: medico.nome,
    procedimentos: validos.length,
    cirurgias,
    guias: guiasParaLimiar,
    guiasConsolidado,
    subtotais,
    totalValor,
    status: alertasDeConferencia.length > 0 ? 'alerta' : 'ok',
    alertas,
    saldoParaProximaCompetencia: saldoFinal,
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
 *
 * Acúmulo (GATE 2026-08-13): as 4 fontes já convergem pra 1 classe/tabela só, então usam o MESMO
 * bucket `guiasPrincipal` do saldo — sem caso especial em relação a um médico normal.
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
  saldoAcumulado: SaldoAcumulado | null | undefined,
  saldoAcumuladoDesde: string | null | undefined,
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

  const s = saldoAcumulado ?? SALDO_VAZIO;

  if (guias === 0 && s.guiasPrincipal === 0) {
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

  const guiasTotal = guias + s.guiasPrincipal;

  if (guiasTotal < LIMIAR_MINIMO_GUIAS) {
    const alertaAcumulo =
      `${guiasTotal} guia(s) combinada(s) abaixo do mínimo de ${LIMIAR_MINIMO_GUIAS} — produção acumulada, ` +
      `aguardando o próximo mês em que o médico for processado` +
      (saldoAcumuladoDesde ? ` (acumulando desde ${saldoAcumuladoDesde})` : '') +
      '.';
    return {
      cpf: medico.cpf ?? '',
      nome: medico.nome,
      procedimentos,
      cirurgias,
      guias: guiasTotal,
      guiasConsolidado,
      subtotais: [],
      totalValor: 0,
      status: 'acumulado',
      alertas: [...alertas, alertaAcumulo],
      saldoParaProximaCompetencia: { guiasPrincipal: guiasTotal, guiasOutrosHospitais: 0, guiasImobilizacoes: 0, valorBasePercentual: 0 },
    };
  }

  // Tabela padrão (crédito/não credenciado) — mesma classe/faixa que qualquer outro médico
  // usaria pro lote principal. Angiologista não tem classe/tabela própria (confirmado pelo dono).
  const classe: Classe = medico.statusHapvida === 'credenciado' ? 'HAPVIDA_CRED' : 'HAPVIDA_NAO_CRED';
  const tabelaClasse = medico.semExcedentePorGuia ? tabelaSemExcedentePorGuia(tabela[classe]) : tabela[classe];
  const { valor, faixa } = valorDaFaixa(tabelaClasse, guiasTotal);
  if (valor == null) {
    alertas.push(`Classe ${classe} com ${guiasTotal} guias está FORA DA TABELA: faixa não definida, verificar.`);
  }

  // Anota na memória de cálculo (faixa) quando a soma inclui guias digitadas manualmente ou
  // acumuladas de meses anteriores — igual ao princípio de nunca esconder de onde veio um número
  // (GATE 2026-08-12, GATE 2026-08-13).
  let faixaAnotada = faixa;
  if (guiasCartaRede > 0) {
    faixaAnotada += ` (inclui ${guiasCartaRede} guia(s) de Carta de Rede informada(s) manualmente)`;
  }
  if (s.guiasPrincipal > 0) {
    faixaAnotada += ` — inclui ${s.guiasPrincipal} guia(s) acumulada(s)${saldoAcumuladoDesde ? ` desde ${saldoAcumuladoDesde}` : ''}`;
  }

  return {
    cpf: medico.cpf ?? '',
    nome: medico.nome,
    procedimentos,
    cirurgias,
    guias: guiasTotal,
    guiasConsolidado,
    subtotais: [{ classe, guias: guiasTotal, valor: valor ?? 0, faixa: faixaAnotada }],
    totalValor: valor ?? 0,
    status: alertas.length > 0 ? 'alerta' : 'ok',
    alertas,
    saldoParaProximaCompetencia: { guiasPrincipal: 0, guiasOutrosHospitais: 0, guiasImobilizacoes: 0, valorBasePercentual: 0 },
  };
}
