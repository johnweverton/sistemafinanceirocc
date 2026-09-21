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
      '12345678900,Dr. Fulano,Cardio,credenciado,nao,nao,nao,Maria,PF,11144477735,Dr. Fulano,fulano@exemplo.com,60000000,Rua A,100,Sala 2,Centro,Fortaleza,CE',
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
      '98765432100,Dra. Ciclana,Pediatria,nao_credenciado,nao,nao,nao,Joao,PJ,11222333000181,Clinica LTDA,contato@ciclana.com,60110000,Av Beira Mar,2000,,Meireles,Fortaleza,CE',
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

// Story 7.3 (AC 4): coluna opcional conta_emissora no modelo estendido.
describe('importação CSV — conta emissora', () => {
  const HEADER_CONTA = `${HEADER},conta_emissora`;

  function parseUmaComConta(linha: string) {
    const rows = parseCsv(`${HEADER_CONTA}\n${linha}`);
    return rowToInput(rows[0]!);
  }

  it('coluna ausente/vazia → campo omitido (default mc fica no banco)', () => {
    const semColuna = parseUma('11122233344,Dr. Beltrano,Orto,credenciado,nao,nao,nao,Maria,,,,,,,,,,,');
    expect('contaEmissora' in semColuna).toBe(false);

    const vazia = parseUmaComConta('11122233344,Dr. Beltrano,Orto,credenciado,nao,nao,nao,Maria,,,,,,,,,,,,');
    expect('contaEmissora' in vazia).toBe(false);
    expect(novoMedicoSchema.safeParse(vazia).success).toBe(true);
  });

  it('valor válido é aceito e chega tipado no schema', () => {
    const input = parseUmaComConta(
      '11122233344,Dr. Beltrano,Orto,credenciado,nao,nao,nao,Maria,,,,,,,,,,,,cavalcante_viana',
    );
    const parsed = novoMedicoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.contaEmissora).toBe('cavalcante_viana');
  });

  it('valor inválido é rejeitado pelo schema com mensagem clara (linha vai para erros[])', () => {
    const input = parseUmaComConta(
      '11122233344,Dr. Beltrano,Orto,credenciado,nao,nao,nao,Maria,,,,,,,,,,,,banco_x',
    );
    expect(novoMedicoSchema.safeParse(input).success).toBe(false);
  });
});

// Campos que faltavam no import (migrations 0006/0018/0019/0025/0027/0028) — atualização da
// planilha desatualizada relatada pelo usuário.
describe('importação CSV — campos estendidos (modo_cobranca, condições, regra de preço, empresa)', () => {
  const COLUNAS_EXT = [
    'cpf', 'nome', 'especialidade', 'status_hapvida', 'faz_outros_hospitais', 'faz_imobilizacoes',
    'modo_mudanca_data', 'colaborador_responsavel', 'pagador_tipo', 'pagador_documento',
    'pagador_nome', 'email', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
    'whatsapp', 'modo_cobranca', 'percentual_producao', 'dias_vencimento', 'multa_percent',
    'juros_mes_percent', 'desconto_percent', 'desconto_dias', 'regra_preco_forma',
    'regra_preco_base', 'regra_preco_limiar', 'regra_preco_taxa', 'regra_preco_valor_fixo',
    'empresa_grupo',
  ] as const;

  /** Monta a linha CSV por posição de coluna — evita contar vírgulas manualmente. */
  function parseUmaExt(campos: Partial<Record<(typeof COLUNAS_EXT)[number], string>>, empresasPorNome?: Map<string, string>) {
    const header = COLUNAS_EXT.join(',');
    const linha = COLUNAS_EXT.map((c) => campos[c] ?? '').join(',');
    const rows = parseCsv(`${header}\n${linha}`);
    return rowToInput(rows[0]!, empresasPorNome);
  }

  it('whatsapp no bloco de cobrança é lido do CSV', () => {
    const input = parseUmaExt({
      cpf: '12345678900', nome: 'Dr. Fulano', especialidade: 'Cardio', status_hapvida: 'credenciado',
      faz_outros_hospitais: 'nao', faz_imobilizacoes: 'nao', modo_mudanca_data: 'nao',
      colaborador_responsavel: 'Maria', pagador_tipo: 'PF', pagador_documento: '11144477735',
      pagador_nome: 'Dr. Fulano', email: 'fulano@exemplo.com', cep: '60000000', logradouro: 'Rua A',
      numero: '100', bairro: 'Centro', cidade: 'Fortaleza', uf: 'CE', whatsapp: '85999998888',
    });
    const parsed = novoMedicoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.cobranca?.whatsapp).toBe('85999998888');
  });

  it('modo_cobranca=percentual_producao com percentual válido é aceito', () => {
    const input = parseUmaExt({
      cpf: '11122233344', nome: 'Dr. Beltrano', especialidade: 'Orto', status_hapvida: 'nenhum',
      faz_outros_hospitais: 'sim', faz_imobilizacoes: 'sim', modo_mudanca_data: 'nao',
      colaborador_responsavel: 'Maria', modo_cobranca: 'percentual_producao', percentual_producao: '35',
    });
    const parsed = novoMedicoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.modoCobranca).toBe('percentual_producao');
      expect(parsed.data.percentualProducao).toBe(35);
    }
  });

  it('overrides comerciais (condicoes) são montados quando algum campo vem preenchido', () => {
    const input = parseUmaExt({
      cpf: '11122233344', nome: 'Dr. Beltrano', especialidade: 'Orto', status_hapvida: 'credenciado',
      faz_outros_hospitais: 'nao', faz_imobilizacoes: 'nao', modo_mudanca_data: 'nao',
      colaborador_responsavel: 'Maria', dias_vencimento: '10', multa_percent: '2', juros_mes_percent: '1',
    });
    const parsed = novoMedicoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.condicoes?.diasVencimento).toBe(10);
      expect(parsed.data.condicoes?.multaPercent).toBe(2);
      expect(parsed.data.condicoes?.jurosMesPercent).toBe(1);
    }
  });

  it('regra_preco por_guia com taxa é aceita quando modo_cobranca=preco_proprio', () => {
    const input = parseUmaExt({
      cpf: '11122233344', nome: 'Dr. Beltrano', especialidade: 'Orto', status_hapvida: 'credenciado',
      faz_outros_hospitais: 'nao', faz_imobilizacoes: 'nao', modo_mudanca_data: 'nao',
      colaborador_responsavel: 'Maria', modo_cobranca: 'preco_proprio', regra_preco_forma: 'por_guia',
      regra_preco_taxa: '4.00',
    });
    const parsed = novoMedicoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.regraPreco?.forma).toBe('por_guia');
      expect(parsed.data.regraPreco?.taxa).toBe(4.0);
    }
  });

  it('empresa_grupo resolvido por nome (normalizado) vira o UUID esperado', () => {
    const empresas = new Map([['medisa', 'empresa-uuid-1']]);
    const input = parseUmaExt(
      {
        cpf: '11122233344', nome: 'Dr. Beltrano', especialidade: 'Orto', status_hapvida: 'credenciado',
        faz_outros_hospitais: 'nao', faz_imobilizacoes: 'nao', modo_mudanca_data: 'nao',
        colaborador_responsavel: 'Maria', empresa_grupo: 'MEDISA',
      },
      empresas,
    );
    expect(input.empresaGrupoId).toBe('empresa-uuid-1');
  });

  it('empresa_grupo com nome não encontrado lança erro explícito (vira erros[] no route)', () => {
    expect(() =>
      parseUmaExt(
        {
          cpf: '11122233344', nome: 'Dr. Beltrano', especialidade: 'Orto', status_hapvida: 'credenciado',
          faz_outros_hospitais: 'nao', faz_imobilizacoes: 'nao', modo_mudanca_data: 'nao',
          colaborador_responsavel: 'Maria', empresa_grupo: 'Inexistente LTDA',
        },
        new Map(),
      ),
    ).toThrow(/Inexistente LTDA/);
  });

  it('empresa_grupo ausente na linha não define empresaGrupoId (sem vínculo, comportamento atual)', () => {
    const input = parseUmaExt({
      cpf: '11122233344', nome: 'Dr. Beltrano', especialidade: 'Orto', status_hapvida: 'credenciado',
      faz_outros_hospitais: 'nao', faz_imobilizacoes: 'nao', modo_mudanca_data: 'nao',
      colaborador_responsavel: 'Maria',
    });
    expect('empresaGrupoId' in input).toBe(false);
  });
});
