// POST /api/medicos/importar — importa lista de médicos via arquivo CSV.
// Formato esperado: ver /templates/medicos-modelo.csv (download na tela de médicos).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarMedico } from '@/server/repositories/medico-repository';
import { novoMedicoSchema } from '@/server/validation/medico-schema';
import { parseCsv, rowToInput } from '@/server/csv/medicos-import';
import type { ImportarResultado } from '@/services/medicos';

// Limites anti-DoS: o arquivo é lido inteiro na memória, então travamos tamanho e nº de linhas.
// ~120 médicos/competência é o volume real (architecture); 5 MB / 5000 linhas é folga generosa.
const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CSV_ROWS = 5000;

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);

  const formData = await req.formData();
  const file = formData.get('arquivo');
  if (!file || !(file instanceof File)) {
    throw new ApiError(422, 'Arquivo CSV não enviado (campo: arquivo)', 'ARQUIVO_INVALIDO');
  }
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new ApiError(422, 'Somente arquivos .csv são aceitos', 'FORMATO_INVALIDO');
  }
  if (file.size > MAX_CSV_BYTES) {
    throw new ApiError(
      413,
      `Arquivo excede o limite de ${MAX_CSV_BYTES / (1024 * 1024)} MB`,
      'ARQUIVO_GRANDE',
    );
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new ApiError(422, 'Arquivo vazio ou sem linhas de dados após o cabeçalho', 'ARQUIVO_VAZIO');
  }
  if (rows.length > MAX_CSV_ROWS) {
    throw new ApiError(
      413,
      `Arquivo excede o limite de ${MAX_CSV_ROWS} linhas`,
      'ARQUIVO_GRANDE',
    );
  }

  const criados: string[] = [];
  const erros: { linha: number; cpf: string; erro: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const linhaCsv = i + 2; // +2: 1 do header + 1 do índice base-zero
    const input = rowToInput(row);
    const parsed = novoMedicoSchema.safeParse(input);
    if (!parsed.success) {
      erros.push({
        linha: linhaCsv,
        cpf: row.cpf ?? '',
        erro: parsed.error.issues.map((e) => e.message).join('; '),
      });
      continue;
    }
    try {
      const m = await criarMedico(parsed.data);
      criados.push(m.id);
    } catch (e) {
      erros.push({
        linha: linhaCsv,
        cpf: row.cpf ?? '',
        erro: e instanceof Error ? e.message : 'Erro ao criar',
      });
    }
  }

  return Response.json({ criados: criados.length, erros } satisfies ImportarResultado);
});
