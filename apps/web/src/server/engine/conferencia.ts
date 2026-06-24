// Trava de conferência e detecção de alertas — porte 1:1 de motor_guias_v2.py (checar).
// PRD §5.3 (modo inconsistente), §5.6 (dado incompleto), §8.5 (variação anômala). Pura.
import type { Procedimento, ModoMudancaData } from '@cobranca/shared';
import { detectarModo, procedimentosValidos, isPediatra } from './contagem';

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
  procedimentos: Procedimento[],
  modoCadastro: ModoMudancaData,
  guias: number,
  historicoGuias?: number | null,
  especialidade?: string | null,
): string[] {
  const alertas: string[] = [];

  if (isPediatra(especialidade)) {
    const modoDetectado = detectarModo(procedimentos);
    if (modoCadastro !== modoDetectado) {
      alertas.push(
        `MODO INCONSISTENTE — cadastro: ${modoCadastro.toUpperCase()}, ` +
          `dado observado: ${modoDetectado.toUpperCase()}. Houve alteração recente?`,
      );
    }
  }

  // Conta apenas procedimentos válidos (com atendimento e senha) que estejam
  // sem valor ou sem descrição — a guia existe, mas o dado está incompleto (PRD §5.6).
  const semValor = procedimentosValidos(procedimentos).filter(
    (p) => p.valor == null || p.descricaoProcedimento == null,
  ).length;
  if (semValor > 0) {
    alertas.push(`${semValor} procedimento(s) sem valor ou descrição no sistema.`);
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
