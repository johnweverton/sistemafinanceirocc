// Alertas de negócio de uma captura do agente ISS (Story 13.1, guarda R5 da arquitetura
// docs/architecture/feature-agente-faturamento-iss.md). Função pura, sem I/O.
//
// R5 — defesa em profundidade à decisão G1: o dono confirmou com a SEFIN que a escrituração do
// ISS Fortaleza continua trazendo as notas mesmo depois da migração do Simples Nacional para o
// Emissor Nacional (01/11/2026). Se um dia isso deixar de valer, o sintoma é um cliente que
// sempre faturou aparecer com 0 — e 0 cai na faixa barata do boleto sem ninguém perceber. Este
// alerta faz a proposta chegar marcada na tela de conferência.
import type { AlertaCapturaIss, StatusCapturaIss } from '@cobranca/shared';

/** Primeira competência emitida pelo Emissor Nacional (Comunicado SEFIN 06/2026). */
export const COMPETENCIA_INICIO_EMISSOR_NACIONAL = '2026-11';

/** Quantas competências anteriores contam como "histórico recente" para R5. */
export const JANELA_HISTORICO_R5 = 3;

export interface CapturaParaAlerta {
  competencia: string;
  status: StatusCapturaIss;
  valorServicosPrestados: number | null;
}

/**
 * @param faturamentosAnteriores faturamentos LANÇADOS do cliente nas `JANELA_HISTORICO_R5`
 *   competências anteriores (as que existirem).
 */
export function alertasDaCapturaIss(
  captura: CapturaParaAlerta,
  faturamentosAnteriores: number[],
): AlertaCapturaIss[] {
  const alertas: AlertaCapturaIss[] = [];
  if (
    captura.status === 'capturado' &&
    captura.valorServicosPrestados === 0 &&
    captura.competencia >= COMPETENCIA_INICIO_EMISSOR_NACIONAL && // 'AAAA-MM' ordena lexicograficamente
    faturamentosAnteriores.some((v) => v > 0)
  ) {
    alertas.push('possivel_nota_fora_escrituracao');
  }
  return alertas;
}

/** As `n` competências imediatamente anteriores a `competencia` ('AAAA-MM'), da mais recente à mais antiga. */
export function competenciasAnteriores(competencia: string, n: number): string[] {
  let [ano, mes] = competencia.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
    out.push(`${ano}-${String(mes).padStart(2, '0')}`);
  }
  return out;
}
