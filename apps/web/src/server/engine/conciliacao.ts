// Motor de conciliação bancária (Story 8.2, Épico 8) — função PURA, sem I/O, testável
// como precos.ts. Implementa o D2 da arquitetura: matching determinístico em camadas de
// confiança sobre pares "crédito não conciliado × boleto pago não conciliado" da MESMA
// conta emissora (o caller garante a conta; o engine garante as regras).
//
// Princípio inegociável: FALSO POSITIVO É PIOR QUE TRABALHO MANUAL.
//   - Camada 1 (conciliado_auto): valor idêntico em centavos + documento da contraparte
//     = documento do pagador do médico + data da transação dentro de ±3 dias da baixa.
//     Auto SÓ quando o par é único NOS DOIS SENTIDOS: a transação tem um único candidato
//     E o boleto casa com uma única transação — qualquer disputa vira 'sugerido'.
//   - Camada 2 (sugerido): valor + janela, sem documento ou documento divergente
//     (pagamento por terceiro é comum). Candidato único é armazenado para confirmação
//     em 1 clique; 2+ candidatos → 'sugerido' SEM candidato (o operador vincula).
//   - Sem par → 'sem_match'. Débitos e tarifas (FEE) nunca entram no matching.
//
// O engine devolve a resolução COMPLETA dos créditos elegíveis (inclusive 'sem_match' e
// o recálculo de 'sugerido' — AC 5); o caller aplica apenas as mudanças, com updates
// condicionais que nunca tocam estados manuais (conciliado_*/ignorado).
import type { StatusConciliacao, TipoTransacaoExtrato } from '@cobranca/shared';

/** Crédito candidato ao matching (shape mínimo, derivado de ExtratoTransacao). */
export interface TransacaoParaConciliacao {
  transacaoId: string;
  tipo: TipoTransacaoExtrato;
  transactionType: string | null;
  /** Em REAIS (comparação interna em centavos para evitar float). */
  valor: number;
  /** CPF/CNPJ da contraparte, só dígitos; null quando o banco não informa. */
  contraparteDocumento: string | null;
  dataTransacao: string;
  /** Estado atual — só 'sem_match' e 'sugerido' são recalculáveis. */
  statusConciliacao: StatusConciliacao;
}

/** Boleto pago ainda sem transação conciliada (shape mínimo). */
export interface BoletoParaConciliacao {
  boletoId: string;
  /** Em REAIS — valor efetivamente pago (baixa do Épico 4). */
  valorPago: number | null;
  pagoEm: string | null;
  /** CPF/CNPJ do pagador do médico (medicos.pagador_documento), só dígitos. */
  pagadorDocumento: string | null;
}

/** Transição proposta pelo motor para uma transação. */
export interface TransicaoConciliacao {
  transacaoId: string;
  status: 'conciliado_auto' | 'sugerido' | 'sem_match';
  /** Boleto vinculado (auto) ou candidato único (sugerido); null sem candidato único. */
  boletoId: string | null;
}

/** Resumo das transições (resposta da rota de sync). */
export interface ResumoConciliacao {
  autoConciliadas: number;
  sugeridas: number;
  semMatch: number;
}

const JANELA_MS = 3 * 24 * 60 * 60 * 1000; // ±3 dias (D2)

function centavos(valor: number): number {
  return Math.round(valor * 100);
}

function dentroDaJanela(dataTransacao: string, pagoEm: string): boolean {
  const dt = Date.parse(dataTransacao);
  const pg = Date.parse(pagoEm);
  if (Number.isNaN(dt) || Number.isNaN(pg)) return false;
  return Math.abs(dt - pg) <= JANELA_MS;
}

/**
 * Resolve o matching de uma conta. Determinístico: a ordem de processamento é estável
 * (dataTransacao, transacaoId) e independe da ordem dos arrays de entrada.
 */
export function conciliar(
  transacoes: TransacaoParaConciliacao[],
  boletos: BoletoParaConciliacao[],
): TransicaoConciliacao[] {
  // Elegibilidade: só créditos que não são tarifa e ainda estão em estado recalculável.
  const creditos = transacoes
    .filter(
      (t) =>
        t.tipo === 'CREDIT' &&
        t.transactionType !== 'FEE' &&
        (t.statusConciliacao === 'sem_match' || t.statusConciliacao === 'sugerido'),
    )
    .sort(
      (a, b) =>
        a.dataTransacao.localeCompare(b.dataTransacao) ||
        a.transacaoId.localeCompare(b.transacaoId),
    );
  // Boleto sem baixa completa (valor/data) não é conciliável.
  const elegiveis = boletos.filter((b) => b.valorPago != null && b.pagoEm != null);

  // Pré-cálculo dos candidatos por transação e do reverso da camada 1 (boleto → transações):
  // o auto exige unicidade nos DOIS sentidos.
  const candidatos = new Map<string, { camada1: string[]; camada2: string[] }>();
  const camada1PorBoleto = new Map<string, number>();
  for (const t of creditos) {
    const camada1: string[] = [];
    const camada2: string[] = [];
    for (const b of elegiveis) {
      if (centavos(t.valor) !== centavos(b.valorPago!)) continue;
      if (!dentroDaJanela(t.dataTransacao, b.pagoEm!)) continue;
      const documentoBate =
        !!t.contraparteDocumento &&
        !!b.pagadorDocumento &&
        t.contraparteDocumento === b.pagadorDocumento;
      if (documentoBate) camada1.push(b.boletoId);
      else camada2.push(b.boletoId);
    }
    candidatos.set(t.transacaoId, { camada1, camada2 });
    for (const boletoId of camada1) {
      camada1PorBoleto.set(boletoId, (camada1PorBoleto.get(boletoId) ?? 0) + 1);
    }
  }

  const transicoes: TransicaoConciliacao[] = [];
  const consumidos = new Set<string>(); // boletos auto-conciliados nesta rodada (1↔1)

  for (const t of creditos) {
    const { camada1, camada2 } = candidatos.get(t.transacaoId)!;
    const c1 = camada1.filter((id) => !consumidos.has(id));
    const c2 = camada2.filter((id) => !consumidos.has(id));

    if (c1.length === 1 && camada1PorBoleto.get(c1[0]!) === 1) {
      // Par único nos dois sentidos → única situação em que o sistema concilia sozinho.
      consumidos.add(c1[0]!);
      transicoes.push({ transacaoId: t.transacaoId, status: 'conciliado_auto', boletoId: c1[0]! });
    } else if (c1.length >= 1) {
      // Ambiguidade na camada 1 (2+ candidatos, ou boleto disputado por 2+ transações).
      transicoes.push({
        transacaoId: t.transacaoId,
        status: 'sugerido',
        boletoId: c1.length === 1 ? c1[0]! : null,
      });
    } else if (c2.length >= 1) {
      transicoes.push({
        transacaoId: t.transacaoId,
        status: 'sugerido',
        boletoId: c2.length === 1 ? c2[0]! : null,
      });
    } else {
      transicoes.push({ transacaoId: t.transacaoId, status: 'sem_match', boletoId: null });
    }
  }

  return transicoes;
}

/** Conta as transições por resultado (resumo da rota de sync). */
export function resumirTransicoes(transicoes: TransicaoConciliacao[]): ResumoConciliacao {
  return {
    autoConciliadas: transicoes.filter((t) => t.status === 'conciliado_auto').length,
    sugeridas: transicoes.filter((t) => t.status === 'sugerido').length,
    semMatch: transicoes.filter((t) => t.status === 'sem_match').length,
  };
}
