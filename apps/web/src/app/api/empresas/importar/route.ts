// POST /api/empresas/importar — importa empresas de agrupamento via arquivo CSV/Excel.
// Formato esperado: ver /templates/empresas-modelo.csv (download na tela de empresas).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarEmpresa, atualizarEmpresa, listarEmpresas } from '@/server/repositories/empresa-repository';
import { novaEmpresaSchema } from '@/server/validation/empresa-schema';
import { rowToInput } from '@/server/csv/empresas-import';
import {
  extrairLinhasDoArquivo,
  processarLinhas,
  normalizarNome,
  type ResultadoImportacao,
} from '@/server/csv/planilha-import';
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

  // Achado do dono (2026-07-30): reimportar a mesma planilha duplicava empresas já cadastradas
  // (nome não tem UNIQUE no banco, então o insert sempre "funcionava" e criava de novo). Nome
  // normalizado (acento/caixa/espaço) é a chave natural aqui — nome duplicado (após normalizar)
  // fica ambíguo e não entra no mapa, para não arriscar atualizar a empresa errada.
  const empresasExistentes = await listarEmpresas();
  const idsPorNome = new Map<string, string>();
  const nomesAmbiguos = new Set<string>();
  for (const e of empresasExistentes) {
    const chave = normalizarNome(e.nome);
    if (idsPorNome.has(chave)) nomesAmbiguos.add(chave);
    else idsPorNome.set(chave, e.id);
  }
  for (const chave of nomesAmbiguos) idsPorNome.delete(chave);

  const resultado = await processarLinhas(rows, {
    rowToInput,
    schema: novaEmpresaSchema,
    criar: criarEmpresa,
    encontrarExistenteId: (data) => (data.nome ? idsPorNome.get(normalizarNome(data.nome)) : undefined),
    atualizar: (id, data) => atualizarEmpresa(id, data, sessao.userId, 'Atualizado via reimportação de planilha'),
    chaveLinha: (row) => row.nome ?? '',
  });

  return Response.json({
    criados: resultado.criados,
    atualizados: resultado.atualizados,
    erros: resultado.erros.map((e) => ({ linha: e.linha, chave: e.chave, erro: e.erro })),
  } satisfies ResultadoImportacao);
});
