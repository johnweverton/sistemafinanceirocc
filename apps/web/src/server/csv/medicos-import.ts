// Parsing de CSV de importação de médicos (Story 3.4). Extraído do route handler porque
// route files do Next não podem exportar funções além dos métodos HTTP.

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0]) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^﻿/, ''));
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(',').map((v) => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
    });
}

export function rowToInput(row: Record<string, string>) {
  const base = {
    cpf: row.cpf ?? '',
    nome: row.nome ?? '',
    especialidade: row.especialidade || null,
    statusHapvida: row.status_hapvida,
    fazOutrosHospitais: row.faz_outros_hospitais === 'sim',
    fazImobilizacoes: row.faz_imobilizacoes === 'sim',
    modoMudancaData: (row.modo_mudanca_data as 'sim' | 'nao') || 'nao',
    colaboradorResponsavel: row.colaborador_responsavel || null,
    ativo: true,
  };

  // Bloco de cobrança é opcional: só monta quando há algum dado na linha. Se parcial/inválido,
  // o novoMedicoSchema reprova a linha e ela entra em `erros[]` (não aborta o lote).
  const temCobranca =
    row.pagador_tipo || row.pagador_documento || row.pagador_nome || row.email || row.cep;
  if (!temCobranca) return base;

  return {
    ...base,
    cobranca: {
      pagadorTipo: row.pagador_tipo,
      pagadorDocumento: (row.pagador_documento || '').replace(/\D/g, ''),
      pagadorNome: row.pagador_nome || '',
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
