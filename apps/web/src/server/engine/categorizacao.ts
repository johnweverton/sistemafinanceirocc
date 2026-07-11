// Motor de categorização do DRE (Story 9.2, Épico 9) — função PURA, sem I/O, mesmo padrão
// de conciliacao.ts. Implementa o D3 da arquitetura:
//   - 2 auto-regras de SISTEMA confirmam sozinhas (dedução lógica de um fato já
//     confirmado, não uma sugestão): crédito já conciliado com boleto (Épico 8) → Receita
//     de honorários; débito FEE → Tarifas bancárias.
//   - Regras do USUÁRIO (palavra-chave em contraparte/descrição) SEMPRE resultam em
//     'sugerida' — nunca confirmam sozinhas, ao contrário das 2 regras de sistema acima.
//   - Nenhuma bateu → 'sem_categoria'.
// As auto-regras de sistema são checadas ANTES das regras do usuário: uma transação que
// já é fato confirmado (crédito conciliado, tarifa bancária) não fica sujeita a uma regra
// de palavra-chave que por acaso bata no nome da contraparte/descrição.
import type { StatusCategorizacao } from '@cobranca/shared';

/** Transação candidata à categorização (shape mínimo, derivado de ExtratoTransacao). */
export interface TransacaoParaCategorizar {
  transacaoId: string;
  tipo: 'CREDIT' | 'DEBIT';
  transactionType: string | null;
  contraparteNome: string | null;
  descricao: string | null;
  /** true quando já está conciliada com um boleto pago (Épico 8) — dispara a auto-regra de receita. */
  conciliadaComBoleto: boolean;
}

/** Regra do usuário, já filtrada por ativo=true e ordenada por prioridade pelo caller. */
export interface RegraParaCategorizar {
  categoriaId: string;
  campo: 'contraparte_nome' | 'descricao';
  padrao: string;
  prioridade: number;
}

/** Ids das 2 categorias de sistema — localizadas por sistema=true + grupo, nunca por nome. */
export interface CategoriasSistema {
  receitaHonorariosId: string;
  tarifasBancariasId: string;
}

export interface CategorizacaoResultado {
  transacaoId: string;
  categoriaId: string | null;
  status: StatusCategorizacao;
}

function bateNaRegra(transacao: TransacaoParaCategorizar, regra: RegraParaCategorizar): boolean {
  const valorCampo =
    regra.campo === 'contraparte_nome' ? transacao.contraparteNome : transacao.descricao;
  if (!valorCampo) return false;
  return valorCampo.toLowerCase().includes(regra.padrao.toLowerCase());
}

/**
 * Categoriza um lote de transações. Determinístico: as regras são aplicadas na ordem
 * recebida (o caller já ordena por prioridade, menor primeiro) — a primeira que bate
 * vence.
 */
export function categorizar(
  transacoes: TransacaoParaCategorizar[],
  regras: RegraParaCategorizar[],
  categoriasSistema: CategoriasSistema,
): CategorizacaoResultado[] {
  const regrasOrdenadas = [...regras].sort((a, b) => a.prioridade - b.prioridade);

  return transacoes.map((t) => {
    if (t.tipo === 'CREDIT' && t.conciliadaComBoleto) {
      return {
        transacaoId: t.transacaoId,
        categoriaId: categoriasSistema.receitaHonorariosId,
        status: 'confirmada',
      };
    }
    if (t.tipo === 'DEBIT' && t.transactionType === 'FEE') {
      return {
        transacaoId: t.transacaoId,
        categoriaId: categoriasSistema.tarifasBancariasId,
        status: 'confirmada',
      };
    }
    const regra = regrasOrdenadas.find((r) => bateNaRegra(t, r));
    if (regra) {
      return { transacaoId: t.transacaoId, categoriaId: regra.categoriaId, status: 'sugerida' };
    }
    return { transacaoId: t.transacaoId, categoriaId: null, status: 'sem_categoria' };
  });
}
