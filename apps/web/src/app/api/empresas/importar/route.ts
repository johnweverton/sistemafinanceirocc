// POST /api/empresas/importar — importa empresas de agrupamento via arquivo CSV/Excel.
// Formato esperado: ver /templates/empresas-modelo.csv (download na tela de empresas).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarEmpresa } from '@/server/repositories/empresa-repository';
import { novaEmpresaSchema } from '@/server/validation/empresa-schema';
import { rowToInput } from '@/server/csv/empresas-import';
import { extrairLinhasDoArquivo, processarLinhas, type ResultadoImportacao } from '@/server/csv/planilha-import';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

// Limites bem menores que médicos: empresas de agrupamento são um cadastro pequeno (dezenas, não
// centenas) — folga generosa sem precisar do mesmo teto de médicos.
const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_CSV_ROWS = 1000;

const importLimiter = createRateLimiter('empresas-importar', { limit: 5, windowMs: 60_000 });

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  assertRateLimit(importLimiter, sessao.userId, 'importação de CSV');

  const formData = await req.formData();
  const rows = await extrairLinhasDoArquivo(formData, { maxBytes: MAX_CSV_BYTES, maxRows: MAX_CSV_ROWS });

  const resultado = await processarLinhas(rows, {
    rowToInput,
    schema: novaEmpresaSchema,
    criar: criarEmpresa,
    chaveLinha: (row) => row.nome ?? '',
  });

  return Response.json({
    criados: resultado.criados,
    erros: resultado.erros.map((e) => ({ linha: e.linha, chave: e.chave, erro: e.erro })),
  } satisfies ResultadoImportacao);
});
