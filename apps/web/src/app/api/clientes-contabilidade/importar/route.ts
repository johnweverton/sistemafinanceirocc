// POST /api/clientes-contabilidade/importar — importa clientes de contabilidade via CSV/Excel.
// Formato esperado: ver /templates/clientes-contabilidade-modelo.csv (download na tela de
// clientes de contabilidade).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  criarClienteContabilidade,
  atualizarClienteContabilidade,
  listarClientesContabilidade,
} from '@/server/repositories/cliente-contabilidade-repository';
import { novoClienteContabilidadeSchema } from '@/server/validation/cliente-contabilidade-schema';
import { rowToInput } from '@/server/csv/clientes-contabilidade-import';
import {
  extrairLinhasDoArquivo,
  processarLinhas,
  normalizarNome,
  type ResultadoImportacao,
} from '@/server/csv/planilha-import';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

// Mesmo porte de empresas: cadastro pequeno (dezenas), não centenas.
const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_CSV_ROWS = 1000;

const importLimiter = createRateLimiter('clientes-contabilidade-importar', { limit: 5, windowMs: 60_000 });

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  assertRateLimit(importLimiter, sessao.userId, 'importação de CSV');

  const formData = await req.formData();
  const rows = await extrairLinhasDoArquivo(formData, { maxBytes: MAX_CSV_BYTES, maxRows: MAX_CSV_ROWS });

  // Achado do dono (2026-07-30): reimportar a mesma planilha (ex.: após corrigir erros apontados
  // na 1ª importação) duplicava clientes já cadastrados — nome não tem UNIQUE no banco, então o
  // insert sempre "funcionava" e criava de novo. Nome normalizado é a chave natural aqui; nome
  // duplicado (após normalizar) fica ambíguo e não entra no mapa, para não atualizar o errado.
  const clientesExistentes = await listarClientesContabilidade();
  const idsPorNome = new Map<string, string>();
  const nomesAmbiguos = new Set<string>();
  for (const c of clientesExistentes) {
    const chave = normalizarNome(c.nome);
    if (idsPorNome.has(chave)) nomesAmbiguos.add(chave);
    else idsPorNome.set(chave, c.id);
  }
  for (const chave of nomesAmbiguos) idsPorNome.delete(chave);

  const resultado = await processarLinhas(rows, {
    rowToInput,
    schema: novoClienteContabilidadeSchema,
    criar: criarClienteContabilidade,
    encontrarExistenteId: (data) => (data.nome ? idsPorNome.get(normalizarNome(data.nome)) : undefined),
    atualizar: (id, data) =>
      atualizarClienteContabilidade(id, data, sessao.userId, 'Atualizado via reimportação de planilha'),
    chaveLinha: (row) => row.nome ?? '',
  });

  return Response.json({
    criados: resultado.criados,
    atualizados: resultado.atualizados,
    erros: resultado.erros.map((e) => ({ linha: e.linha, chave: e.chave, erro: e.erro })),
  } satisfies ResultadoImportacao);
});
