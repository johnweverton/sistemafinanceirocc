// Mock Conta Gateway — implementação de ContaBancariaPort para dev/testes (Story 8.1).
// Extrato sintético DETERMINÍSTICO: o mesmo período devolve sempre as mesmas transações
// (entryId derivado do início do período) — o upsert idempotente do sync é exercitável
// em dev re-sincronizando o mesmo período. Sem rede, sem certificado.
import type {
  ContaBancariaPort,
  FiltroExtrato,
  ResultadoExtrato,
  ResultadoSaldo,
  TransacaoExtratoApi,
} from '@cobranca/shared';

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Modelo fixo das transações sintéticas — cobre crédito conciliável, Pix, tarifa e débito. */
const MODELO_TRANSACOES = [
  {
    sufixo: 'credito-boleto',
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    valor: 1500,
    descricao: 'Liquidação de boleto (mock)',
    contraparteNome: 'Dr. Mock da Silva',
    contraparteDocumento: '12345678901',
    diaOffset: 0,
  },
  {
    sufixo: 'credito-pix',
    tipo: 'CREDIT',
    transactionType: 'PIX',
    valor: 350.5,
    descricao: 'Pix recebido (mock)',
    contraparteNome: 'Clínica Mock LTDA',
    contraparteDocumento: '12345678000199',
    diaOffset: 1,
  },
  {
    sufixo: 'tarifa',
    tipo: 'DEBIT',
    transactionType: 'FEE',
    valor: 9.9,
    descricao: 'Tarifa de emissão de boleto (mock)',
    contraparteNome: null,
    contraparteDocumento: null,
    diaOffset: 1,
  },
  {
    sufixo: 'transferencia',
    tipo: 'DEBIT',
    transactionType: 'TRANSFER',
    valor: 2000,
    descricao: 'Transferência enviada (mock)',
    contraparteNome: 'Fornecedor Mock',
    contraparteDocumento: '98765432000188',
    diaOffset: 2,
  },
] as const;

/** Soma dias a uma data YYYY-MM-DD e devolve timestamp ISO ao meio-dia UTC (estável). */
function dataComOffset(inicio: string, dias: number): string {
  const d = new Date(`${inicio}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString();
}

export class MockContaGateway implements ContaBancariaPort {
  async consultarExtrato(filtros: FiltroExtrato): Promise<ResultadoExtrato> {
    // Mesma validação do gateway real — dev exercita o mesmo contrato de erro.
    if (!FORMATO_DATA.test(filtros.inicio) || !FORMATO_DATA.test(filtros.fim)) {
      return {
        sucesso: false,
        erro: `Período inválido: datas devem ser YYYY-MM-DD (recebido '${filtros.inicio}' a '${filtros.fim}')`,
      };
    }
    const transacoes: TransacaoExtratoApi[] = MODELO_TRANSACOES.map((m) => ({
      entryId: `MOCK-${filtros.inicio}-${m.sufixo}`,
      tipo: m.tipo,
      transactionType: m.transactionType,
      valor: m.valor,
      descricao: m.descricao,
      contraparteNome: m.contraparteNome,
      contraparteDocumento: m.contraparteDocumento,
      dataTransacao: dataComOffset(filtros.inicio, m.diaOffset),
      payload: { mock: true, sufixo: m.sufixo },
    }));
    return { sucesso: true, transacoes };
  }

  async consultarSaldo(): Promise<ResultadoSaldo> {
    return {
      sucesso: true,
      saldo: { disponivel: 25000.42, bloqueado: 0, consultadoEm: new Date().toISOString() },
    };
  }
}
