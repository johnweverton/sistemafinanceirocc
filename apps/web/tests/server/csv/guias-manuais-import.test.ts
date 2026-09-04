// Importação da planilha de guias CONFERIDAS MANUALMENTE (migration 0058, aprovado 2026-09-03).
// A resolução é pura (linhas + cadastro → linhas resolvidas / erros de linha) — nada de I/O.
// Regra de ouro: linha que não resolve com certeza vira ERRO EXPLÍCITO, nunca descarte silencioso.
import { describe, it, expect } from 'vitest';
import type { Medico } from '@cobranca/shared';
import { resolverGuiasManuais, normalizarCpf } from '../../../src/server/csv/guias-manuais-import';

function medicoFake(over: Partial<Medico> & { id: string; nome: string; cpf: string }): Medico {
  return {
    especialidade: 'Urologia',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    contaEmissora: 'mc',
    colaboradorResponsavel: null,
    ativo: true,
    necessitaConfiguracao: false,
    externalId: `ext-${over.id}`,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  } as Medico;
}

const cadastro: Medico[] = [
  medicoFake({ id: 'med-1', nome: 'Dr. Fulano de Tal', cpf: '11144477735' }),
  medicoFake({ id: 'med-2', nome: 'Dra. Ciclana', cpf: '98765432100' }),
];

function linha(over: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    cpf: '11144477735',
    nome: 'Dr. Fulano de Tal',
    competencia: '2026-06',
    total_guias: '42',
    motivo: 'Conferencia manual do dono',
    ...over,
  } as Record<string, string>;
}

describe('resolverGuiasManuais', () => {
  it('linha válida resolve o médico por CPF e devolve total + motivo', () => {
    const r = resolverGuiasManuais([linha()], cadastro, '2026-06');

    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      linha: 2,
      medicoId: 'med-1',
      medicoNome: 'Dr. Fulano de Tal',
      cpf: '11144477735',
      guiasManuaisTotal: 42,
      guiasManuaisMotivo: 'Conferencia manual do dono',
    });
  });

  it('CPF formatado (pontos/traço) casa igual — normaliza para dígitos', () => {
    const r = resolverGuiasManuais([linha({ cpf: '111.444.777-35' })], cadastro, '2026-06');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]?.medicoId).toBe('med-1');
  });

  it('o cruzamento é SÓ por CPF — nome divergente na planilha não impede nem redireciona', () => {
    const r = resolverGuiasManuais([linha({ nome: 'nome digitado errado' })], cadastro, '2026-06');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]?.medicoId).toBe('med-1');
    // O nome do CADASTRO é o que o operador confere na tela; o da planilha fica só de referência.
    expect(r.linhas[0]?.medicoNome).toBe('Dr. Fulano de Tal');
    expect(r.linhas[0]?.nomePlanilha).toBe('nome digitado errado');
  });

  it('CPF não encontrado no cadastro → erro de linha explícito (nunca ignora)', () => {
    const r = resolverGuiasManuais([linha({ cpf: '00000000191' })], cadastro, '2026-06');

    expect(r.linhas).toEqual([]);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatchObject({ linha: 2, chave: '00000000191' });
    expect(r.erros[0]?.erro).toContain('não encontrado no cadastro');
  });

  it('CPF duplicado na planilha → TODAS as ocorrências viram erro (não escolhe uma)', () => {
    const r = resolverGuiasManuais(
      [linha({ total_guias: '42' }), linha({ total_guias: '50' })],
      cadastro,
      '2026-06',
    );

    expect(r.linhas).toEqual([]);
    expect(r.erros).toHaveLength(2);
    expect(r.erros[0]?.erro).toContain('aparece 2× na planilha');
  });

  it('competência divergente da execução → erro de linha', () => {
    const r = resolverGuiasManuais([linha({ competencia: '2026-05' })], cadastro, '2026-06');

    expect(r.linhas).toEqual([]);
    expect(r.erros[0]?.erro).toContain('diferente da competência desta emissão');
  });

  it('competência em formato inválido → erro de linha', () => {
    const r = resolverGuiasManuais([linha({ competencia: '06/2026' })], cadastro, '2026-06');
    expect(r.erros[0]?.erro).toContain('AAAA-MM');
  });

  it('total de guias ausente, não inteiro ou negativo → erro de linha', () => {
    const casos = ['', 'abc', '4,5', '4.5', '-1'];
    for (const total_guias of casos) {
      const r = resolverGuiasManuais([linha({ total_guias })], cadastro, '2026-06');
      expect(r.linhas, `total "${total_guias}" deveria ser rejeitado`).toEqual([]);
      expect(r.erros).toHaveLength(1);
    }
  });

  it('total 0 é aceito (é um número conferido, não um campo em branco)', () => {
    const r = resolverGuiasManuais([linha({ total_guias: '0' })], cadastro, '2026-06');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]?.guiasManuaisTotal).toBe(0);
  });

  it('motivo vazio → erro de linha (é o texto do alerta de auditoria)', () => {
    const r = resolverGuiasManuais([linha({ motivo: '   ' })], cadastro, '2026-06');
    expect(r.linhas).toEqual([]);
    expect(r.erros[0]?.erro).toContain('Motivo não informado');
  });

  it('CPF em branco ou com dígitos de menos → erro de linha', () => {
    const semCpf = resolverGuiasManuais([linha({ cpf: '' })], cadastro, '2026-06');
    expect(semCpf.erros[0]?.erro).toContain('CPF não informado');

    const curto = resolverGuiasManuais([linha({ cpf: '123' })], cadastro, '2026-06');
    expect(curto.erros[0]?.erro).toContain('11 dígitos');
  });

  it('médico fora da emissão (inativo / pendente / sem vínculo) → erro com o motivo certo', () => {
    const inativo = medicoFake({ id: 'med-3', nome: 'Dr. Inativo', cpf: '52998224725', ativo: false });
    const pendente = medicoFake({
      id: 'med-4',
      nome: 'Dr. Pendente',
      cpf: '15350946056',
      necessitaConfiguracao: true,
    });
    const semVinculo = medicoFake({ id: 'med-5', nome: 'Dr. Sem Vinculo', cpf: '12345678909', externalId: null });
    const base = [...cadastro, inativo, pendente, semVinculo];

    expect(resolverGuiasManuais([linha({ cpf: '52998224725' })], base, '2026-06').erros[0]?.erro).toContain(
      'inativo',
    );
    expect(resolverGuiasManuais([linha({ cpf: '15350946056' })], base, '2026-06').erros[0]?.erro).toContain(
      'pendente de configuração',
    );
    expect(resolverGuiasManuais([linha({ cpf: '12345678909' })], base, '2026-06').erros[0]?.erro).toContain(
      'vínculo',
    );
  });

  it('linhas boas e ruins convivem: a boa passa, a ruim vira erro (o lote não aborta)', () => {
    const r = resolverGuiasManuais(
      [linha(), linha({ cpf: '98765432100', nome: 'Dra. Ciclana', total_guias: 'x' })],
      cadastro,
      '2026-06',
    );

    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]?.medicoId).toBe('med-1');
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]?.linha).toBe(3);
  });

  it('planilha vazia → nada resolvido, nenhum erro', () => {
    expect(resolverGuiasManuais([], cadastro, '2026-06')).toEqual({ linhas: [], erros: [] });
  });
});

// Achado 2026-09-04 (feedback do dono): "o médico pode ter produção normal, imobilizações,
// consultas e etc... são tabelas diferentes, não tenho como colocar 200 se 100 foi guias normal
// e 100 foi consultas". Cada coluna de total (total_guias/total_consultas/total_imobilizacoes/
// total_outros_hospitais) agora é independente e opcional por linha.
describe('resolverGuiasManuais — colunas por classe (achado 2026-09-04)', () => {
  const medicoPediatra = medicoFake({
    id: 'med-pediatra',
    nome: 'Dr. Pediatra',
    cpf: '52998224725',
    especialidade: 'Pediatria',
  });
  const medicoImobilizacoes = medicoFake({
    id: 'med-imob',
    nome: 'Dr. Imob',
    cpf: '15350946056',
    fazImobilizacoes: true,
  });
  const medicoOutrosHospitais = medicoFake({
    id: 'med-outros',
    nome: 'Dr. Outros',
    cpf: '12345678909',
    fazOutrosHospitais: true,
  });
  const medicoAngiologista = medicoFake({
    id: 'med-angio',
    nome: 'Dr. Angio',
    cpf: '87041307172',
    especialidade: 'Angiologia',
  });
  const cadastroCompleto = [...cadastro, medicoPediatra, medicoImobilizacoes, medicoOutrosHospitais, medicoAngiologista];

  it('preenche só total_consultas (deixa total_guias em branco) — aceito, guiasManuaisTotal ausente', () => {
    const r = resolverGuiasManuais(
      [linha({ cpf: '52998224725', total_guias: '', total_consultas: '40' })],
      cadastroCompleto,
      '2026-06',
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ guiasManuaisConsultas: 40 });
    expect(r.linhas[0]).not.toHaveProperty('guiasManuaisTotal');
  });

  it('preenche total_guias E total_consultas juntos — os dois viram overrides independentes', () => {
    const r = resolverGuiasManuais(
      [linha({ cpf: '52998224725', total_guias: '15', total_consultas: '40' })],
      cadastroCompleto,
      '2026-06',
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ guiasManuaisTotal: 15, guiasManuaisConsultas: 40 });
  });

  it('total_consultas preenchido pra médico que não é Pediatra → erro de linha', () => {
    const r = resolverGuiasManuais(
      [linha({ total_consultas: '40' })], // linha() usa o CPF do Dr. Fulano (Urologia)
      cadastroCompleto,
      '2026-06',
    );
    expect(r.linhas).toEqual([]);
    expect(r.erros[0]?.erro).toContain('não é Pediatra');
  });

  it('total_imobilizacoes preenchido pra médico sem fazImobilizacoes → erro de linha', () => {
    const r = resolverGuiasManuais([linha({ total_imobilizacoes: '12' })], cadastroCompleto, '2026-06');
    expect(r.linhas).toEqual([]);
    expect(r.erros[0]?.erro).toContain('não tem Imobilizações marcado');
  });

  it('total_imobilizacoes válido pra médico com fazImobilizacoes', () => {
    const r = resolverGuiasManuais(
      [linha({ cpf: '15350946056', total_guias: '', total_imobilizacoes: '12' })],
      cadastroCompleto,
      '2026-06',
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ guiasManuaisImobilizacoes: 12 });
  });

  it('total_outros_hospitais preenchido pra médico sem fazOutrosHospitais → erro de linha', () => {
    const r = resolverGuiasManuais([linha({ total_outros_hospitais: '9' })], cadastroCompleto, '2026-06');
    expect(r.linhas).toEqual([]);
    expect(r.erros[0]?.erro).toContain('não tem Outros Hospitais marcado');
  });

  it('total_outros_hospitais válido pra médico com fazOutrosHospitais', () => {
    const r = resolverGuiasManuais(
      [linha({ cpf: '12345678909', total_guias: '', total_outros_hospitais: '9' })],
      cadastroCompleto,
      '2026-06',
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ guiasManuaisOutrosHospitais: 9 });
  });

  it('nenhuma das 4 colunas preenchida → erro de linha explícito (a linha não teria efeito)', () => {
    const r = resolverGuiasManuais([linha({ total_guias: '' })], cadastroCompleto, '2026-06');
    expect(r.linhas).toEqual([]);
    expect(r.erros[0]?.erro).toContain('Nenhuma coluna de total preenchida');
  });

  it('coluna com valor inválido (não inteiro/negativo) → erro nomeando a coluna certa', () => {
    const casos: [string, Record<string, string>][] = [
      ['total_consultas', { cpf: '52998224725', total_guias: '', total_consultas: 'abc' }],
      ['total_imobilizacoes', { cpf: '15350946056', total_guias: '', total_imobilizacoes: '-1' }],
      ['total_outros_hospitais', { cpf: '12345678909', total_guias: '', total_outros_hospitais: '4.5' }],
    ];
    for (const [coluna, overrides] of casos) {
      const r = resolverGuiasManuais([linha(overrides)], cadastroCompleto, '2026-06');
      expect(r.linhas, `${coluna} deveria ser rejeitado`).toEqual([]);
      expect(r.erros[0]?.erro).toContain(coluna);
    }
  });

  it('médico Angiologista: QUALQUER coluna preenchida → erro explícito (planilha não suportada pra essa especialidade)', () => {
    const casos = [
      { total_guias: '10' },
      { total_guias: '', total_consultas: '5' }, // hipotético (Angiologista não é pediatra, mas o gate de Angiologista vem primeiro)
      { total_guias: '', total_imobilizacoes: '5' },
      { total_guias: '', total_outros_hospitais: '5' },
    ];
    for (const overrides of casos) {
      const r = resolverGuiasManuais(
        [linha({ cpf: '87041307172', ...overrides })],
        cadastroCompleto,
        '2026-06',
      );
      expect(r.linhas).toEqual([]);
      expect(r.erros[0]?.erro).toContain('Angiologista');
    }
  });

  it('motivo continua obrigatório quando qualquer uma das 4 colunas vem preenchida', () => {
    const r = resolverGuiasManuais(
      [linha({ cpf: '15350946056', total_guias: '', total_imobilizacoes: '12', motivo: '' })],
      cadastroCompleto,
      '2026-06',
    );
    expect(r.linhas).toEqual([]);
    expect(r.erros[0]?.erro).toContain('Motivo não informado');
  });
});

describe('normalizarCpf', () => {
  it('mantém só os dígitos', () => {
    expect(normalizarCpf('111.444.777-35')).toBe('11144477735');
    expect(normalizarCpf(null)).toBe('');
    expect(normalizarCpf(undefined)).toBe('');
  });
});
