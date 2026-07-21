// Pipeline principal do motor — porte 1:1 de motor_guias_v2.py (processar_medico).
// Função pura: recebe médico + procedimentos já buscados, devolve resultado agregado.
// NÃO faz I/O (sem Supabase, sem fetch) — Coding Standard "Engine sem I/O".
import type {
  EntradaProcessamentoMedico,
  ResultadoMedico,
  TabelaPreco,
  Subtotal,
} from '@cobranca/shared';
import {
  itensValidos,
  contarGuiasProducao,
  consolidarProducao,
  detectarModoProducao,
  contarConsultasProducao,
  isPediatra,
} from './contagem-producao';
import { checar } from './conferencia';
import { classesDoMedico, valorDaFaixa, TABELA_PRECO_PADRAO, VALOR_CONSULTA_PEDIATRIA_PADRAO } from './precos';
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
  const { medico, itens, historicoGuias, itensConsultas } = entrada;
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
        'Modo percentual sem percentual configurado — valor zerado, corrigir cadastro do médico.',
      );
    }
    if (itensSemValor > 0) {
      alertas.push(
        `${itensSemValor} item(ns) sem valor cobrado na origem — base do percentual SUBCONTADA, verificar.`,
      );
    }
    if (base <= 0) {
      alertas.push('Base de produção zerada — nenhum valor cobrado na origem, verificar.');
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
    for (const classe of classesDoMedico(medico)) {
      const { valor, faixa } = valorDaFaixa(tabela[classe], guias);
      subtotais.push({ classe, guias, valor: valor ?? 0, faixa });
      totalValor += valor ?? 0;
      // valor null = fora da tabela (PRD §11 outros hospitais > 80) → vira alerta, não chuta.
      if (valor == null) {
        alertas.push(
          `Classe ${classe} com ${guias} guias está FORA DA TABELA — faixa não definida, verificar.`,
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
