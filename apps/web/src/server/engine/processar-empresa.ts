// Cálculo agregado por empresa (Story 10.4b, Épico 10) — soma a produção de guias cardíacas
// de vários médicos e aplica a regra de preço da empresa UMA VEZ sobre o total. Função pura,
// sem I/O (o orquestrador busca os itens de cada médico antes de chamar esta função).
//
// Reaproveita `contarGuiasProducao` (Engine, sem mudança) e `aplicarRegraPreco` (extraída da
// Story 10.1 nesta mesma story) — o agregado é o MESMO mecanismo de preço próprio de um
// médico, só que a origem do número de guias é a soma de vários médicos em vez de um só.
import type { ItemProducao, RegraPreco } from '@cobranca/shared';
import { contarGuiasProducao } from './contagem-producao';
import { aplicarRegraPreco } from './regra-preco';

export interface ProducaoMedico {
  medicoId: string;
  itens: ItemProducao[];
  especialidade?: string | null;
}

export interface ContribuicaoMedico {
  medicoId: string;
  guias: number;
  valor: number;
}

export interface EntradaProcessamentoEmpresa {
  regraPreco: RegraPreco | null;
  medicos: ProducaoMedico[];
}

export interface ResultadoEmpresa {
  guias: number;
  totalValor: number;
  status: 'ok' | 'alerta';
  alertas: string[];
  /** Memória de cálculo (mesmo formato do subtotal `PRECO_PROPRIO` do médico individual). */
  subtotalFaixa: string;
  /** Auditoria "qual médico contribuiu quanto" — vazia quando há alerta. */
  contribuicoes: ContribuicaoMedico[];
}

/**
 * Soma os guias de todos os médicos do grupo e aplica a regra de preço da empresa sobre o
 * total. MVP (Story 10.4b, AC 3): só a forma `por_guia` é suportada — as demais (`base_excedente`/
 * `fixo`) exigiriam uma decisão de rateio entre médicos que o dono não confirmou, então viram
 * alerta explícito em vez de uma distribuição chutada (PRD §2).
 */
export function processarEmpresa(entrada: EntradaProcessamentoEmpresa): ResultadoEmpresa {
  const { regraPreco, medicos } = entrada;

  if (regraPreco && regraPreco.forma !== 'por_guia') {
    return {
      guias: 0,
      totalValor: 0,
      status: 'alerta',
      alertas: [
        `Forma de regra "${regraPreco.forma}" não suportada para agregação por empresa — só "por guia" é suportada nesta versão. Corrigir cadastro da empresa.`,
      ],
      subtotalFaixa: '',
      contribuicoes: [],
    };
  }

  const guiasPorMedico = medicos.map((m) => ({
    medicoId: m.medicoId,
    guias: contarGuiasProducao(m.itens, m.especialidade).guias,
  }));
  const guiasTotal = guiasPorMedico.reduce((acc, m) => acc + m.guias, 0);

  const resultado = aplicarRegraPreco(regraPreco, guiasTotal);

  if (resultado.alertas.length > 0) {
    return {
      guias: guiasTotal,
      totalValor: 0,
      status: 'alerta',
      alertas: resultado.alertas,
      subtotalFaixa: '',
      contribuicoes: [],
    };
  }

  // Garantido pela forma 'por_guia' já ter passado por aplicarRegraPreco sem alerta.
  const taxa = regraPreco!.taxa!;
  const contribuicoes: ContribuicaoMedico[] = guiasPorMedico.map((m) => ({
    medicoId: m.medicoId,
    guias: m.guias,
    valor: m.guias * taxa,
  }));

  return {
    guias: guiasTotal,
    totalValor: resultado.valor,
    status: 'ok',
    alertas: [],
    subtotalFaixa: resultado.subtotalFaixa,
    contribuicoes,
  };
}
