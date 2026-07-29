// Parsing de linha de importação de médicos (Story 3.4). parseCsv/parseExcel e os blocos de
// condições/regra de preço são genéricos e vivem em planilha-import.ts (reaproveitados por
// empresas/clientes-contabilidade); aqui fica só o mapeamento específico do domínio médico.
import { parseCsv, parseExcel, condicoesDaLinha, regraPrecoDaLinha } from './planilha-import';
export { parseCsv, parseExcel };

/**
 * Resolve o vínculo com empresa de agrupamento por NOME (não UUID) — é o que uma planilha
 * preenchida à mão vai ter. Mesma normalização usada em medico-sync.ts (tolera acentuação/caixa).
 */
function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// Retorno tipado frouxamente (Record) de propósito: os blocos condicionais abaixo geram uma
// união de formatos que só interessa ao `novoMedicoSchema.safeParse` (recebe `unknown`) — travar
// o tipo aqui só infla a assinatura sem ganho de segurança real.
export function rowToInput(
  row: Record<string, string>,
  empresasPorNome: Map<string, string> = new Map(),
): Record<string, unknown> {
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
    // Coluna opcional conta_emissora (Story 7.3): ausente/vazia → default 'mc' do banco;
    // valor inválido é reprovado pelo novoMedicoSchema e a linha entra em `erros[]`.
    ...(row.conta_emissora ? { contaEmissora: row.conta_emissora } : {}),
    // Modo de cobrança (Story 6.2) / regra de preço própria (Story 10.1): ausente → default
    // 'faixa_guias' do schema. percentualProducao/regraPreco só fazem sentido quando o modo
    // pede — coerência é validada pelo novoMedicoSchema (refine), não aqui.
    ...(row.modo_cobranca ? { modoCobranca: row.modo_cobranca } : {}),
    ...(row.percentual_producao ? { percentualProducao: Number(row.percentual_producao) } : {}),
    ...regraPrecoDaLinha(row, row.modo_cobranca === 'preco_proprio'),
  };

  const comCondicoes = {
    ...base,
    ...condicoesDaLinha(row),
  };

  const empresaGrupoId = resolverEmpresaGrupoId(row, empresasPorNome);
  const comEmpresa = empresaGrupoId !== undefined ? { ...comCondicoes, empresaGrupoId } : comCondicoes;

  // Bloco de cobrança é opcional: só monta quando há algum dado na linha. Se parcial/inválido,
  // o novoMedicoSchema reprova a linha e ela entra em `erros[]` (não aborta o lote).
  const temCobranca =
    row.pagador_tipo || row.pagador_documento || row.pagador_nome || row.email || row.cep;
  if (!temCobranca) return comEmpresa;

  return {
    ...comEmpresa,
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

/**
 * Resolve `empresa_grupo` (nome, coluna do template) para o UUID esperado por `empresaGrupoId`.
 * Retorna `undefined` quando a coluna não veio na linha (sem vínculo, comportamento atual).
 * Nome preenchido mas não encontrado no cadastro lança — vira erro de linha explícito em vez de
 * ser ignorado silenciosamente (homônimos/typos não podem virar vínculo errado nem "sem vínculo").
 */
function resolverEmpresaGrupoId(
  row: Record<string, string>,
  empresasPorNome: Map<string, string>,
): string | null | undefined {
  const nome = row.empresa_grupo?.trim();
  if (!nome) return undefined;
  const id = empresasPorNome.get(normalizarNome(nome));
  if (!id) {
    throw new Error(`Empresa de agrupamento "${nome}" não encontrada (empresa_grupo)`);
  }
  return id;
}
