// Parsing de linha de importação de empresas de agrupamento (Story 10.4a). Mesmo padrão de
// medicos-import.ts, reaproveitando os blocos compartilhados de planilha-import.ts — empresa não
// tem statusHapvida/modoCobranca (Pick<Empresa, 'nome'|'cobranca'|'condicoes'|'regraPreco'|'ativo'>).
import { condicoesDaLinha, regraPrecoDaLinha } from './planilha-import';

export function rowToInput(row: Record<string, string>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    nome: row.nome ?? '',
    ativo: true,
    // Coluna opcional conta_emissora (Story 7.3): ausente/vazia → default 'mc' do banco.
    ...(row.conta_emissora ? { contaEmissora: row.conta_emissora } : {}),
    ...condicoesDaLinha(row),
    ...regraPrecoDaLinha(row),
  };

  // Bloco de cobrança é opcional: só monta quando há algum dado na linha. Se parcial/inválido,
  // o novaEmpresaSchema reprova a linha e ela entra em `erros[]` (não aborta o lote).
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
