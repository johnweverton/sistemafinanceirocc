// Partes puras do CLI: argumentos, competência, configuração, relatório e redação do CPF.
import { describe, it, expect } from 'vitest';
import { lerOpcoes, ErroArgs } from '../src/args';
import { competenciaAnterior, competenciaPortal, dataCompetenciaPortal } from '../src/competencia';
import { lerArquivoEnv, validarConfig, ErroConfig } from '../src/config';
import { redigirCpf } from '../src/diagnostico';
import { montarExecucao, resumoTexto } from '../src/relatorio';

describe('competência', () => {
  it('mês anterior, inclusive na virada do ano', () => {
    expect(competenciaAnterior(new Date(2026, 8, 21))).toBe('2026-08');
    expect(competenciaAnterior(new Date(2027, 0, 5))).toBe('2026-12');
  });
  it('formatos do portal', () => {
    expect(competenciaPortal('2026-08')).toBe('08/2026');
    expect(dataCompetenciaPortal('2026-08')).toBe('01/08/2026');
  });
});

describe('lerOpcoes', () => {
  const hoje = new Date(2026, 8, 21);
  it('padrões', () => {
    expect(lerOpcoes([], hoje)).toMatchObject({ competencia: '2026-08', documentos: [], limite: null, headed: false, semEnvio: false });
  });
  it('--cnpj aceita máscara e repete', () => {
    expect(lerOpcoes(['--cnpj', '08.293.377/0001-98', '--cnpj', '07286006000116'], hoje).documentos).toEqual([
      '08293377000198',
      '07286006000116',
    ]);
  });
  it('--offline exige --cnpj e implica sem envio', () => {
    expect(() => lerOpcoes(['--offline'], hoje)).toThrow(/--cnpj/);
    expect(lerOpcoes(['--offline', '--cnpj', '07286006000116'], hoje)).toMatchObject({ offline: true, semEnvio: true });
  });
  it.each([
    [['--competencia', '08/2026']],
    [['--cnpj', '123']],
    [['--limite', '0']],
    [['--opcao-que-nao-existe']],
  ])('rejeita %j', (argv) => expect(() => lerOpcoes(argv, hoje)).toThrow(ErroArgs));
});

describe('config', () => {
  const vars = { ISS_CPF: '000.000.000-00', ISS_SENHA: 's', AGENTE_ISS_TOKEN: 'x'.repeat(64), SISTEMA_URL: 'https://sistema.exemplo.com/' };

  it('lê .env com comentários e aspas', () => {
    expect(lerArquivoEnv('# c\nA=1\nB="dois"\n\nC = três')).toEqual({ A: '1', B: 'dois', C: 'três' });
  });
  it('normaliza CPF e URL', () => {
    expect(validarConfig('C:\\Users\\x\\agente-iss', vars)).toMatchObject({ issCpf: '00000000000', sistemaUrl: 'https://sistema.exemplo.com' });
  });
  it('--offline só exige as credenciais do portal', () => {
    expect(validarConfig('C:\a', { ISS_CPF: '00000000000', ISS_SENHA: 's' }, { apenasPortal: true })).toMatchObject({ token: '', sistemaUrl: '' });
  });
  it('recusa pasta dentro do OneDrive (senha iria para a nuvem)', () => {
    expect(() => validarConfig('C:\\Users\\x\\OneDrive\\agente-iss', vars)).toThrow(/OneDrive/);
  });
  it('recusa http que não seja localhost, token curto e variável faltando', () => {
    expect(() => validarConfig('C:\\a', { ...vars, SISTEMA_URL: 'http://sistema.com' })).toThrow(ErroConfig);
    expect(() => validarConfig('C:\\a', { ...vars, AGENTE_ISS_TOKEN: 'curto' })).toThrow(ErroConfig);
    expect(() => validarConfig('C:\\a', { ...vars, ISS_SENHA: '' })).toThrow(/ISS_SENHA/);
  });
});

describe('redigirCpf', () => {
  it('remove o CPF com e sem máscara', () => {
    expect(redigirCpf('a 12345678901 b 123.456.789-01 c', '12345678901')).toBe('a [CPF] b [CPF] c');
  });
});

describe('relatório', () => {
  const captura = {
    clienteContabilidadeId: 'c1', status: 'capturado' as const, valorServicosPrestados: 618.84, quantidadeNotas: 3,
    situacaoIss: 'Aberta - Normal', competenciaFechada: false, inscricaoMunicipal: '0765432-1',
    razaoSocialIss: 'X', mensagemErro: null, capturadoEm: '2026-09-21T10:00:00.000Z',
  };
  it('payload no formato da rota (Story 13.1)', () => {
    const e = montarExecucao({
      competencia: '2026-08', iniciadoEm: new Date('2026-09-21T10:00:00Z'), finalizadoEm: new Date('2026-09-21T10:30:00Z'),
      maquina: 'PC', versaoAgente: '0.1.0', resultados: [{ nome: 'X', documento: '1', captura }],
    });
    expect(e).toMatchObject({ competencia: '2026-08', capturas: [captura], ciencias: [] });
  });
  it('resumo avisa competência aberta', () => {
    expect(resumoTexto('2026-08', [{ nome: 'EMPRESA', documento: '1', captura }])).toMatch(/ABERTA/);
  });
});
