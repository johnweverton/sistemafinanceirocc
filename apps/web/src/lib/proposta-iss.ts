// Estado da proposta do ISS para UM cliente no diálogo de lote (Story 13.3, Épico 13).
// Lógica pura: decide se o campo de faturamento vem pré-preenchido e qual aviso acompanha o valor.
// Regras da arquitetura (docs/architecture/feature-agente-faturamento-iss.md §3 e §6):
//   - R2: competência aberta no ISS pré-preenche, mas avisa que o valor pode mudar;
//   - R4: já existe lançamento com valor diferente ⇒ NÃO pré-preenche, mostra a divergência;
//   - R5: captura com alerta (ex.: valor 0 depois da migração ao Emissor Nacional) ⇒ NÃO
//     pré-preenche; o operador precisa olhar antes de aceitar;
//   - captura sem valor (não encontrado / sem escrituração / erro) ⇒ campo vazio, digitação manual.
import type { CapturaIss } from '@cobranca/shared';

export type EstadoPropostaIss =
  | { tipo: 'sem_captura' }
  | { tipo: 'indisponivel'; captura: CapturaIss }
  | { tipo: 'preenchivel'; captura: CapturaIss; valor: number; aberta: boolean }
  | { tipo: 'alerta'; captura: CapturaIss; valor: number }
  | { tipo: 'divergente'; captura: CapturaIss; valor: number; lancado: number }
  | { tipo: 'confere'; captura: CapturaIss; valor: number; lancado: number };

/** Compara em centavos: 0.1 + 0.2 e afins não podem criar divergência fantasma. */
export function mesmoValor(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export function estadoPropostaIss(
  captura: CapturaIss | undefined,
  lancado: number | undefined,
): EstadoPropostaIss {
  if (!captura) return { tipo: 'sem_captura' };
  if (captura.status !== 'capturado' || captura.valorServicosPrestados === null) {
    return { tipo: 'indisponivel', captura };
  }
  const valor = captura.valorServicosPrestados;
  if (lancado !== undefined) {
    return mesmoValor(valor, lancado)
      ? { tipo: 'confere', captura, valor, lancado }
      : { tipo: 'divergente', captura, valor, lancado };
  }
  if (captura.alertas.length > 0) return { tipo: 'alerta', captura, valor };
  return { tipo: 'preenchivel', captura, valor, aberta: captura.competenciaFechada === false };
}

/** Valor que o campo mostra quando o operador ainda não mexeu nele. */
export function valorInicialDoCampo(estado: EstadoPropostaIss): string {
  return estado.tipo === 'preenchivel' ? String(estado.valor) : '';
}

/**
 * Captura a citar no lançamento: só quando o valor final do campo é EXATAMENTE o da proposta.
 * (O servidor confere de novo — isto só evita alegar proveniência que o operador desfez ao digitar.)
 */
export function capturaAceita(estado: EstadoPropostaIss, valorFinal: number): string | undefined {
  if (estado.tipo === 'sem_captura' || estado.tipo === 'indisponivel') return undefined;
  return mesmoValor(estado.valor, valorFinal) ? estado.captura.id : undefined;
}
