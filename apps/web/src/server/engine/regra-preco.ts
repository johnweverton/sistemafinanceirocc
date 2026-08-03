// Regra de preço própria — extraída de processar-medico.ts (Story 10.4b) para ser reaproveitada
// tanto pelo médico individual (modo 'preco_proprio', Story 10.1) quanto pelo agregado de
// empresa (Story 10.4b) quanto pelo cliente contábil no modo 'faixa_faturamento' (Story 11.2) —
// mesma lógica, a única diferença é o que a "quantidade" representa (guias contadas vs.
// faturamento em R$ informado). Função pura, sem I/O.
import type { RegraPreco } from '@cobranca/shared';

export interface ResultadoRegraPreco {
  valor: number;
  /** Vazio quando a regra foi aplicada com sucesso; alertas nunca chutam valor (PRD §2). */
  alertas: string[];
  /** Memória de cálculo para exibição (vazia quando há alerta). */
  subtotalFaixa: string;
}

/**
 * Aplica uma regra de preço (`por_guia`, `base_excedente`, `fixo` ou `faixa_faturamento`) a uma
 * quantidade — guias (médico/empresa) ou faturamento em R$ (cliente contábil, Story 11.2).
 * Regra ausente ou incompleta nunca chuta valor — devolve alerta e valor 0.
 */
export function aplicarRegraPreco(regra: RegraPreco | null, quantidade: number): ResultadoRegraPreco {
  if (!regra) {
    return {
      valor: 0,
      alertas: ['Modo preço próprio sem regra configurada: valor zerado, corrigir cadastro do médico.'],
      subtotalFaixa: '',
    };
  }

  if (regra.forma === 'por_guia') {
    if (regra.taxa == null) {
      return {
        valor: 0,
        alertas: ['Regra de preço "por guia" sem taxa configurada: valor zerado, corrigir cadastro do médico.'],
        subtotalFaixa: '',
      };
    }
    return {
      valor: quantidade * regra.taxa,
      alertas: [],
      subtotalFaixa: `${quantidade} × R$${regra.taxa.toFixed(2)} (por guia)`,
    };
  }

  if (regra.forma === 'base_excedente') {
    if (regra.base == null || regra.limiar == null || regra.taxa == null) {
      return {
        valor: 0,
        alertas: ['Regra de preço "base + excedente" incompleta (falta base, limiar ou taxa): valor zerado, corrigir cadastro.'],
        subtotalFaixa: '',
      };
    }
    const excedente = Math.max(0, quantidade - regra.limiar);
    return {
      valor: regra.base + excedente * regra.taxa,
      alertas: [],
      subtotalFaixa: `base R$${regra.base.toFixed(2)} + ${excedente} × R$${regra.taxa.toFixed(2)} (limiar ${regra.limiar} guias)`,
    };
  }

  if (regra.forma === 'faixa_faturamento') {
    if (regra.limiar == null || regra.valorAbaixoLimiar == null || regra.valorAcimaLimiar == null) {
      return {
        valor: 0,
        alertas: [
          'Regra de preço "faixa de faturamento" incompleta (falta limiar, valor abaixo ou valor acima): valor zerado, corrigir cadastro.',
        ],
        subtotalFaixa: '',
      };
    }
    // faturamento (aqui, `quantidade`) >= limiar entra na faixa de cima (GATE do dono, 2026-07-24).
    const naFaixaDeCima = quantidade >= regra.limiar;
    const valor = naFaixaDeCima ? regra.valorAcimaLimiar : regra.valorAbaixoLimiar;
    return {
      valor,
      alertas: [],
      subtotalFaixa: `faturamento R$${quantidade.toFixed(2)} ${naFaixaDeCima ? '≥' : '<'} R$${regra.limiar.toFixed(2)} → R$${valor.toFixed(2)}`,
    };
  }

  // forma === 'fixo'
  if (regra.valorFixo == null) {
    return {
      valor: 0,
      alertas: ['Regra de preço "fixo" sem valor configurado: valor zerado, corrigir cadastro do médico.'],
      subtotalFaixa: '',
    };
  }
  return {
    valor: regra.valorFixo,
    alertas: [],
    subtotalFaixa: `valor fixo R$${regra.valorFixo.toFixed(2)} (independe de guias)`,
  };
}
