// POST /api/medicos/importar — importa lista de médicos via arquivo CSV/Excel.
// Formato esperado: ver /templates/medicos-modelo.csv (download na tela de médicos).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarMedico } from '@/server/repositories/medico-repository';
import { listarEmpresas } from '@/server/repositories/empresa-repository';
import { novoMedicoSchema } from '@/server/validation/medico-schema';
import { rowToInput } from '@/server/csv/medicos-import';
import { extrairLinhasDoArquivo, processarLinhas } from '@/server/csv/planilha-import';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import type { ImportarResultado } from '@/services/medicos';

// Limites anti-DoS: o arquivo é lido inteiro na memória, então travamos tamanho e nº de linhas.
// ~120 médicos/competência é o volume real (architecture); 5 MB / 5000 linhas é folga generosa.
const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CSV_ROWS = 5000;

// Achado I-1: rate limit — máximo 5 imports por minuto por usuário.
const importLimiter = createRateLimiter('medicos-importar', { limit: 5, windowMs: 60_000 });

function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  assertRateLimit(importLimiter, sessao.userId, 'importação de CSV');

  const formData = await req.formData();
  const rows = await extrairLinhasDoArquivo(formData, { maxBytes: MAX_CSV_BYTES, maxRows: MAX_CSV_ROWS });

  // 1 query para resolver `empresa_grupo` (nome, coluna do template) → UUID, em vez de buscar
  // por linha. Nome duplicado (após normalização) fica ambíguo — não escolhe a primeira, deixa
  // de fora do mapa (a linha que citar esse nome vira erro de "não encontrada").
  const empresas = await listarEmpresas();
  const empresasPorNome = new Map<string, string>();
  const nomesAmbiguos = new Set<string>();
  for (const e of empresas) {
    const chave = normalizarNome(e.nome);
    if (empresasPorNome.has(chave)) nomesAmbiguos.add(chave);
    else empresasPorNome.set(chave, e.id);
  }
  for (const chave of nomesAmbiguos) empresasPorNome.delete(chave);

  const resultado = await processarLinhas(rows, {
    rowToInput: (row) => rowToInput(row, empresasPorNome),
    schema: novoMedicoSchema,
    criar: criarMedico,
    chaveLinha: (row) => row.cpf ?? '',
  });

  return Response.json({
    criados: resultado.criados,
    erros: resultado.erros.map((e) => ({ linha: e.linha, cpf: e.chave, erro: e.erro })),
  } satisfies ImportarResultado);
});
