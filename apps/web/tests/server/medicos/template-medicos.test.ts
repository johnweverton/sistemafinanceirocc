// Garante que o template público (baixado pelo usuário) continua sincronizado com o parser e o
// schema — evita a inconsistência que já existiu (whatsapp lido pelo rowToInput mas ausente do
// template CSV).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv, parseExcel, rowToInput } from '@/server/csv/medicos-import';
import { novoMedicoSchema } from '@/server/validation/medico-schema';

describe('template público medicos-modelo.csv', () => {
  it('toda linha de exemplo é aceita pelo schema (sem empresa_grupo preenchida)', () => {
    const caminho = resolve(__dirname, '../../../public/templates/medicos-modelo.csv');
    const texto = readFileSync(caminho, 'utf8');
    const rows = parseCsv(texto);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const input = rowToInput(row);
      const parsed = novoMedicoSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Linha do template (CPF ${row.cpf}) reprovada: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
  });
});

describe('template público medicos-modelo.xlsx', () => {
  it('toda linha de exemplo é aceita pelo schema (mesmas colunas do CSV)', async () => {
    const caminho = resolve(__dirname, '../../../public/templates/medicos-modelo.xlsx');
    const buffer = readFileSync(caminho);
    const rows = await parseExcel(buffer);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const input = rowToInput(row);
      const parsed = novoMedicoSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Linha do template XLSX (CPF ${row.cpf}) reprovada: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
  });
});
