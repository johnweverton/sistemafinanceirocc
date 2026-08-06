// Trava de conferência e detecção de alertas — porte 1:1 de motor_guias_v2.py (checar).
// PRD §5.3 (modo inconsistente), §5.6 (dado incompleto), §8.5 (variação anômala). Pura.
import type { ModoMudancaData } from '@cobranca/shared';
import type { ItemProducao, ModoObservado } from '@cobranca/shared';
import { usaRegra3x1 } from './contagem-producao';

/** Limiar de variação anômala mês a mês (PRD §8.5, §11 — sugestão inicial 40%). */
export const LIMIAR_VARIACAO = 0.4;

/**
 * Gera a lista de alertas de conferência para um médico.
 * Espelha checar() do Python:
 *  - modo do cadastro != modo observado no dado → alerta (PRD §5.3)
 *  - procedimentos sem valor OU sem descrição → alerta de dado incompleto (PRD §5.6)
 *  - variação > LIMIAR vs. histórico → alerta (PRD §8.5)
 */
export function checar(
  itens: ItemProducao[],
  modoCadastro: ModoMudancaData,
  guias: number,
  historicoGuias?: number | null,
  especialidade?: string | null,
  modoDetectado?: ModoObservado,
): string[] {
  const alertas: string[] = [];

  if (usaRegra3x1(especialidade) && modoDetectado) {
    if (modoCadastro !== modoDetectado) {
      alertas.push(
        `MODO INCONSISTENTE. Cadastro: ${modoCadastro.toUpperCase()}, ` +
          `dado observado: ${modoDetectado.toUpperCase()}. Houve alteração recente?`,
      );
    }
  }

  // Na API real financeira os valores monetários não contam (são ignorados), mas 
  // alertamos se vier sem código ou sem descrição
  const incompletos = itens.filter(
    (p) => !p.codigoProcedimento || !p.descricaoProcedimento,
  ).length;
  if (incompletos > 0) {
    alertas.push(`${incompletos} procedimento(s) sem código ou descrição na origem.`);
  }

  if (historicoGuias != null && historicoGuias > 0 && guias > 0) {
    const variacao = Math.abs(guias - historicoGuias) / historicoGuias;
    if (variacao > LIMIAR_VARIACAO) {
      const pct = Math.round(variacao * 100);
      alertas.push(
        `VARIAÇÃO ALTA em relação ao mês anterior: ${historicoGuias} → ${guias} guias (${pct}%).`,
      );
    }
  }

  return alertas;
}
