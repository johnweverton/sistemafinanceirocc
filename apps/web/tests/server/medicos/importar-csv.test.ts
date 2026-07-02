// Testes do parsing de CSV de importação de médicos com dados de cobrança (Story 3.4).
import { describe, it, expect } from 'vitest';
import { parseCsv, rowToInput } from '@/server/csv/medicos-import';
import { novoMedicoSchema } from '@/server/validation/medico-schema';

const HEADER =
  'cpf,nome,especialidade,status_hapvida,faz_outros_hospitais,faz_imobilizacoes,modo_mudanca_data,colaborador_responsavel,pagador_tipo,pagador_documento,pagador_nome,email,cep,logradouro,numero,complemento,bairro,cidade,uf';

function parseUma(linha: string) {
  const rows = parseCsv(`${HEADER}\n${linha}`);
  return rowToInput(rows[0]!);
}

describe('importação CSV — dados de cobrança', () => {
  it('linha sem cobrança importa o médico sem bloco (cobrança omitida)', () => {
    const input = parseUma('11122233344,Dr. Beltrano,Ortopedia,nenhum,sim,sim,nao,Maria,,,,,,,,,,,');
    expect('cobranca' in input).toBe(false);
    expect(novoMedicoSchema.safeParse(input).success).toBe(true);
  });

  it('linha com cobrança PF válida é aceita', () => {
    const input = parseUma(
      '12345678900,Dr. Fulano,Cardio,credenciado,nao,nao,nao,Maria,PF,12345678900,Dr. Fulano,fulano@exemplo.com,60000000,Rua A,100,Sala 2,Centro,Fortaleza,CE',
    );
    const parsed = novoMedicoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cobranca?.pagadorTipo).toBe('PF');
      expect(parsed.data.cobranca?.uf).toBe('CE');
    }
  });

  it('linha com cobrança PJ válida (14 dígitos) é aceita', () => {
    const input = parseUma(
      '98765432100,Dra. Ciclana,Pediatria,nao_credenciado,nao,nao,nao,Joao,PJ,12345678000199,Clinica LTDA,contato@ciclana.com,60110000,Av Beira Mar,2000,,Meireles,Fortaleza,CE',
    );
    expect(novoMedicoSchema.safeParse(input).success).toBe(true);
  });

  it('linha com cobrança inválida (UF inexistente) é rejeitada pelo schema', () => {
    const input = parseUma(
      '12345678900,Dr. Fulano,Cardio,credenciado,nao,nao,nao,Maria,PF,12345678900,Dr. Fulano,fulano@exemplo.com,60000000,Rua A,100,,Centro,Fortaleza,ZZ',
    );
    expect(novoMedicoSchema.safeParse(input).success).toBe(false);
  });

  it('linha com documento incompatível com o tipo (PF com 14 dígitos) é rejeitada', () => {
    const input = parseUma(
      '12345678900,Dr. Fulano,Cardio,credenciado,nao,nao,nao,Maria,PF,12345678000199,Dr. Fulano,fulano@exemplo.com,60000000,Rua A,100,,Centro,Fortaleza,CE',
    );
    expect(novoMedicoSchema.safeParse(input).success).toBe(false);
  });
});
