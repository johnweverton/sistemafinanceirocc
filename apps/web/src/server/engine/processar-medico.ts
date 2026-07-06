// Pipeline principal do motor — porte 1:1 de motor_guias_v2.py (processar_medico).
// Função pura: recebe médico + procedimentos já buscados, devolve resultado agregado.
// NÃO faz I/O (sem Supabase, sem fetch) — Coding Standard "Engine sem I/O".
import type {
  EntradaProcessamentoMedico,
  ResultadoMedico,
  TabelaPreco,
  Subtotal,
} from '@cobranca/shared';
import { contarGuias, consolidarPorAtendimento, procedimentosValidos } from './contagem';
import { checar } from './conferencia';
import { classesDoMedico, valorDaFaixa, TABELA_PRECO_PADRAO } from './precos';

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
): ResultadoMedico {
  const { medico, procedimentos, historicoGuias } = entrada;
  const validos = procedimentosValidos(procedimentos);

  if (validos.length === 0) {
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
      alertas: ['Nenhum procedimento encontrado para essa competência.'],
    };
  }

  const { guias, cirurgias } = contarGuias(procedimentos, medico.especialidade);
  const guiasConsolidado = consolidarPorAtendimento(procedimentos, medico.especialidade);
  const alertas = checar(procedimentos, medico.modoMudancaData, guias, historicoGuias, medico.especialidade);

  const subtotais: Subtotal[] = [];
  let totalValor = 0;
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
