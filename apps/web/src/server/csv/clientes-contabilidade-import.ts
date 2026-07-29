// Parsing de linha de importação de clientes de contabilidade (Story 11.1, Epic 11). Mesmo
// padrão de medicos-import.ts/empresas-import.ts, reaproveitando os blocos compartilhados de
// planilha-import.ts.
import { condicoesDaLinha, regraPrecoDaLinha } from './planilha-import';

export function rowToInput(row: Record<string, string>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    nome: row.nome ?? '',
    regimeTributario: row.regime_tributario,
    modoCobranca: row.modo_cobranca,
    ativo: true,
    // Coluna opcional conta_emissora (Story 7.3): ausente/vazia → default 'mc' do banco.
    ...(row.conta_emissora ? { contaEmissora: row.conta_emissora } : {}),
    ...condicoesDaLinha(row),
    // Ativa mesmo sem nenhum campo regra_preco_* preenchido quando modo_cobranca exige regra
    // própria (ambos os modos, faixa_faturamento/fixo, usam `regraPreco` na prática) — linha
    // incompleta vira erro de validação claro em vez de "sem regra" silencioso.
    ...regraPrecoDaLinha(row, Boolean(row.modo_cobranca)),
    // Adicional semestral (migration 0030) — só monta quando adicional_ativo=sim.
    ...adicionalDaLinha(row),
  };

  // Bloco de cobrança é opcional: só monta quando há algum dado na linha. Se parcial/inválido,
  // o novoClienteContabilidadeSchema reprova a linha e ela entra em `erros[]`.
  const temCobranca =
    row.pagador_tipo || row.pagador_documento || row.pagador_nome || row.email || row.cep;
  if (!temCobranca) return base;

  return {
    ...base,
    cobranca: {
      pagadorTipo: row.pagador_tipo,
      pagadorDocumento: (row.pagador_documento || '').replace(/\D/g, ''),
      pagadorNome: row.pagador_nome || '',
      whatsapp: (row.whatsapp || '').replace(/\D/g, ''),
      email: row.email || '',
      cep: (row.cep || '').replace(/\D/g, ''),
      logradouro: row.logradouro || '',
      numero: row.numero || '',
      complemento: row.complemento || null,
      bairro: row.bairro || '',
      cidade: row.cidade || '',
      uf: (row.uf || '').toUpperCase(),
    },
  };
}

function adicionalDaLinha(row: Record<string, string>): Record<string, unknown> {
  const ativo = row.adicional_ativo === 'sim';
  if (!ativo) return {};
  return {
    adicionalAtivo: true,
    adicionalValor: row.adicional_valor ? Number(row.adicional_valor) : null,
    adicionalIntervaloMeses: row.adicional_intervalo_meses ? Number(row.adicional_intervalo_meses) : null,
    adicionalCompetenciaBase: row.adicional_competencia_base || null,
  };
}
