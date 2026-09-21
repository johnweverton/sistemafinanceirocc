import { describe, it, expect } from 'vitest';
import {
  ErroExtracao,
  competenciaFechada,
  extrairSomatorioServicosPrestados,
  lerInscricaoAtual,
  linhaDaCompetencia,
  mesmaInscricao,
  valorBR,
} from '../src/extracao/extracao';

// Cabeçalho/rodapé exatamente como o portal real mostra (gravação 2026-09-21).
const CAB = ['', 'Serviços Prestados', 'Quantidade', 'Valor do Serviço', 'Deduções permitidas em Lei', 'Descontos Incondicionados', 'Base de Cálculo', 'ISS Devido (*)'];
const rodape = (qtd: string, valor: string) => ['', 'Somatório', qtd, valor, '0,00', '0,00', valor, '0,00'];

describe('valorBR', () => {
  it.each([
    ['618,84', 618.84],
    ['4.330,18', 4330.18],
    ['1.234.567,89', 1234567.89],
    ['0,00', 0],
    [' 8.000,00 ', 8000],
  ])('%s → %s', (t, v) => expect(valorBR(t)).toBe(v));

  it.each(['', '-', '1,5', '1.2345,00', '618.84', 'R$ 10,00', '10'])('rejeita "%s"', (t) => {
    expect(valorBR(t)).toBeNull();
  });
});

describe('extrairSomatorioServicosPrestados', () => {
  it('lê valor e quantidade pela coluna do cabeçalho', () => {
    expect(extrairSomatorioServicosPrestados({ cabecalho: CAB, rodape: rodape('3', '618,84') })).toEqual({
      valor: 618.84,
      quantidade: 3,
    });
  });

  it('zero é um valor legítimo (empresa sem nota no mês)', () => {
    expect(extrairSomatorioServicosPrestados({ cabecalho: CAB, rodape: rodape('0', '0,00') }).valor).toBe(0);
  });

  it('recusa tabela que não é a de Serviços Prestados', () => {
    const tomados = CAB.map((c) => (c === 'Serviços Prestados' ? 'Serviços Tomados' : c));
    expect(() => extrairSomatorioServicosPrestados({ cabecalho: tomados, rodape: rodape('1', '4.330,18') })).toThrow(ErroExtracao);
  });

  it('recusa rodapé sem "Somatório" ou desalinhado do cabeçalho', () => {
    expect(() =>
      extrairSomatorioServicosPrestados({ cabecalho: CAB, rodape: rodape('1', '1,00').map((c) => (c === 'Somatório' ? 'Total' : c)) }),
    ).toThrow(/Somatório/);
    expect(() => extrairSomatorioServicosPrestados({ cabecalho: CAB, rodape: rodape('1', '1,00').slice(1) })).toThrow(/colunas/);
  });

  it('recusa valor ilegível em vez de chutar', () => {
    expect(() => extrairSomatorioServicosPrestados({ cabecalho: CAB, rodape: rodape('1', '---') })).toThrow(/ilegível/);
  });
});

describe('situação e inscrição', () => {
  it('competenciaFechada', () => {
    expect(competenciaFechada('Fechada - Retificadora(1)')).toBe(true);
    expect(competenciaFechada('Aberta - Normal')).toBe(false);
    expect(competenciaFechada('Outra coisa')).toBeNull();
  });

  it('lerInscricaoAtual', () => {
    expect(lerInscricaoAtual('Inscrição Atual: 123456-7 EMPRESA ALFA LTDA')).toEqual({
      inscricao: '123456-7',
      razaoSocial: 'EMPRESA ALFA LTDA',
    });
    expect(lerInscricaoAtual('Selecione uma inscrição')).toBeNull();
  });

  it('mesmaInscricao ignora zero à esquerda e pontuação, mas não aceita vazio', () => {
    expect(mesmaInscricao('123456-7', '0123456-7')).toBe(true);
    expect(mesmaInscricao('123456-7', '0765432-1')).toBe(false);
    expect(mesmaInscricao('', '')).toBe(false);
  });

  it('linhaDaCompetencia', () => {
    const linhas = [
      { competencia: '09/2026', situacao: 'Aberta - Normal', indice: 0 },
      { competencia: '08/2026', situacao: 'Fechada - Retificadora(1)', indice: 1 },
    ];
    expect(linhaDaCompetencia(linhas, '08/2026')?.indice).toBe(1);
    expect(linhaDaCompetencia(linhas, '07/2026')).toBeNull();
  });
});
