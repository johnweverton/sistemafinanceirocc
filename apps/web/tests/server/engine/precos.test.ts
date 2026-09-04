// Testes da tabela de preço (PRD §5.1) — faixas, excedente e o caso FORA DA TABELA (§11).
import { describe, it, expect } from 'vitest';
import type { ItemProducao } from '@cobranca/shared';
import { valorDaFaixa, classesDoMedico, tabelaSemExcedentePorGuia, TABELA_PRECO_PADRAO } from '../../../src/server/engine';
import { processarMedico } from '../../../src/server/engine/processar-medico';

describe('valorDaFaixa — HAPVIDA_CRED', () => {
  const t = TABELA_PRECO_PADRAO.HAPVIDA_CRED;
  it('30 guias → R$263,59 (primeira faixa)', () => {
    expect(valorDaFaixa(t, 30).valor).toBe(263.59);
  });
  it('17 guias → cai na faixa até 30', () => {
    const r = valorDaFaixa(t, 17);
    expect(r.valor).toBe(263.59);
    expect(r.faixa).toBe('até 30 guias');
  });
  it('180 guias → R$950,89 (última faixa)', () => {
    expect(valorDaFaixa(t, 180).valor).toBe(950.89);
  });
  it('200 guias → excedente por guia: 950,89 + 20×6 = 1070,89', () => {
    expect(valorDaFaixa(t, 200).valor).toBeCloseTo(950.89 + 20 * 6, 2);
  });
});

describe('valorDaFaixa — OUTROS_HOSPITAIS acima de 80 (PRD §11, revisado — Story 10.3)', () => {
  const t = TABELA_PRECO_PADRAO.OUTROS_HOSPITAIS;
  it('80 guias → R$367,36 (último teto definido)', () => {
    expect(valorDaFaixa(t, 80).valor).toBe(367.36);
  });
  // Story 10.3 (2026-07-20): decisão consciente do dono revisa o PRD §11 — antes o motor
  // devolvia "FORA DA TABELA" acima de 80; a planilha real sempre cobrou o teto fixo.
  // Caso de ouro: Dr. Anderson Ferreira (abr/2026) — 118 outros hospitais → R$367,36.
  it('81 guias → cobra o teto fixo R$367,36 (não extrapola por guia)', () => {
    const r = valorDaFaixa(t, 81);
    expect(r.valor).toBe(367.36);
    expect(r.faixa).toContain('acima de 80');
  });
  it('118 guias (Anderson Ferreira, abr/2026) → R$367,36, igual a 81', () => {
    expect(valorDaFaixa(t, 118).valor).toBe(367.36);
  });
});

describe('valorDaFaixa — IMOBILIZACOES (excedente fixo)', () => {
  const t = TABELA_PRECO_PADRAO.IMOBILIZACOES;
  it('150 guias → R$186,10', () => {
    expect(valorDaFaixa(t, 150).valor).toBe(186.1);
  });
  it('151 guias → valor fixo R$387,78', () => {
    expect(valorDaFaixa(t, 151).valor).toBe(387.78);
  });
});

describe('processarMedico — OUTROS_HOSPITAIS acima de 80, somado a Hapvida (Story 10.3, split de lote corrigido na 10.5)', () => {
  function item(id: number): ItemProducao {
    return {
      data: '2026-04-01',
      pacienteNome: `Paciente ${id}`,
      atendimentoExternoId: null,
      codigoProcedimento: '31309054',
      descricaoProcedimento: 'Procedimento teste',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: false,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 100,
      valorPagoOrigem: 100,
    };
  }

  it('médico não-credenciado + outros hospitais: 18 guias no lote principal + 118 no lote de outros hospitais (Anderson Ferreira, abr/2026) → cada lote na sua tabela, sem alerta de FORA DA TABELA', () => {
    const itensPrincipal = Array.from({ length: 18 }, (_, i) => item(i));
    const itensOutrosHospitais = Array.from({ length: 118 }, (_, i) => item(1000 + i));
    const r = processarMedico({
      medico: {
        id: 'anderson', cpf: '00000000004', nome: 'Dr. Anderson Ferreira',
        statusHapvida: 'nao_credenciado', fazOutrosHospitais: true,
        fazImobilizacoes: false, modoMudancaData: 'nao', especialidade: 'Cardiologia',
      } as any,
      itens: itensPrincipal,
      itensOutrosHospitais,
    });

    // 18 guias no lote principal → HAPVIDA_NAO_CRED até 30 (310,06); 118 no lote de outros
    // hospitais → OUTROS_HOSPITAIS acima de 80 cobra o teto fixo (367,36). Total: 677,42
    // (evidência real: Dr. Anderson Ferreira, abr/2026).
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_NAO_CRED', guias: 18, valor: 310.06 }),
      expect.objectContaining({ classe: 'OUTROS_HOSPITAIS', guias: 118, valor: 367.36 }),
    ]);
    expect(r.totalValor).toBeCloseTo(310.06 + 367.36, 2);
    expect(r.status).toBe('ok');
    expect(r.alertas).toEqual([]);
  });

  // Story 10.5 — bug real corrigido: o motor reaproveitava a MESMA contagem de guias do lote
  // principal para a tabela de OUTROS_HOSPITAIS (cobrando a mesma produção 2x em tabelas
  // diferentes). Caso de ouro: Dr. Marcel Rolim Queiroz — 42 guias de produção normal
  // (credenciado) + 19 guias de outros hospitais, em LOTES SEPARADOS.
  it('Dr. Marcel Rolim Queiroz: 42 guias credenciado + 19 guias outros hospitais (lotes separados) → R$566,32, não R$652,42', () => {
    const itensPrincipal = Array.from({ length: 42 }, (_, i) => item(i));
    const itensOutrosHospitais = Array.from({ length: 19 }, (_, i) => item(1000 + i));
    const r = processarMedico({
      medico: {
        id: 'marcel', cpf: '00000000005', nome: 'Dr. Marcel Rolim Queiroz',
        statusHapvida: 'credenciado', fazOutrosHospitais: true,
        fazImobilizacoes: false, modoMudancaData: 'nao', especialidade: 'Ortopedia',
      } as any,
      itens: itensPrincipal,
      itensOutrosHospitais,
    });

    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 42, valor: 394.12 }),
      expect.objectContaining({ classe: 'OUTROS_HOSPITAIS', guias: 19, valor: 172.2 }),
    ]);
    expect(r.totalValor).toBeCloseTo(566.32, 2);
    // Bug antigo (corrigido nesta story): reaproveitava as 50 guias "consolidadas" nas duas
    // tabelas → 394,12 (50 guias Hapvida) + 258,30 (50 guias Outros Hospitais) = 652,42.
    expect(r.totalValor).not.toBeCloseTo(652.42, 2);
    expect(r.status).toBe('ok');
  });

  it('médico com fazOutrosHospitais mas SEM o lote separado selecionado → alerta explícito, guias de Outros Hospitais NÃO cobradas (nunca chuta)', () => {
    const itensPrincipal = Array.from({ length: 42 }, (_, i) => item(i));
    const r = processarMedico({
      medico: {
        id: 'marcel', cpf: '00000000005', nome: 'Dr. Marcel Rolim Queiroz',
        statusHapvida: 'credenciado', fazOutrosHospitais: true,
        fazImobilizacoes: false, modoMudancaData: 'nao', especialidade: 'Ortopedia',
      } as any,
      itens: itensPrincipal,
      // itensOutrosHospitais ausente (undefined) — operador não selecionou o lote.
    });

    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 42, valor: 394.12 }),
    ]);
    expect(r.totalValor).toBeCloseTo(394.12, 2);
    expect(r.status).toBe('alerta');
    expect(
      r.alertas.some((a) => a.includes('Outros Hospitais') && a.includes('não foi selecionado')),
    ).toBe(true);
  });

  // Story 10.6 — na origem, "Outros Hospitais" não abre uma produção por mês como o lote
  // principal: um único lote acumula vários meses. Sem filtrar por competência, um médico com
  // 19 guias de abr/2026 + 5 de mar/2026 no MESMO lote seria cobrado por 24, não 19.
  function itemComData(id: number, data: string): ItemProducao {
    return { ...item(id), data };
  }

  it('lote de Outros Hospitais com itens de outra competência → ignora os de fora do mês e alerta, sem afetar Imobilizações (GATE do dono)', () => {
    const itensPrincipal = Array.from({ length: 42 }, (_, i) => item(i));
    const itensOutrosHospitais = [
      ...Array.from({ length: 19 }, (_, i) => itemComData(1000 + i, '2026-04-15')), // competência certa
      ...Array.from({ length: 5 }, (_, i) => itemComData(2000 + i, '2026-03-10')), // mês anterior, mesmo lote
    ];
    const itensImobilizacoes = [
      ...Array.from({ length: 3 }, (_, i) => itemComData(3000 + i, '2026-04-20')),
      ...Array.from({ length: 2 }, (_, i) => itemComData(4000 + i, '2026-02-01')), // GATE: Imobilizações NÃO filtra
    ];

    const r = processarMedico({
      medico: {
        id: 'marcel', cpf: '00000000005', nome: 'Dr. Marcel Rolim Queiroz',
        statusHapvida: 'credenciado', fazOutrosHospitais: true,
        fazImobilizacoes: true, modoMudancaData: 'nao', especialidade: 'Ortopedia',
      } as any,
      itens: itensPrincipal,
      itensOutrosHospitais,
      itensImobilizacoes,
      competencia: '2026-04',
    });

    // OUTROS_HOSPITAIS conta só os 19 da competência certa (mesmo valor de ouro do caso Marcel
    // acima), NÃO os 24 do lote inteiro.
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 42, valor: 394.12 }),
      expect.objectContaining({ classe: 'OUTROS_HOSPITAIS', guias: 19, valor: 172.2 }),
      // Imobilizações NÃO filtra por competência (GATE do dono): conta os 5 itens do lote
      // inteiro, incluindo o de fevereiro.
      expect.objectContaining({ classe: 'IMOBILIZACOES', guias: 5 }),
    ]);
    expect(r.status).toBe('alerta');
    expect(
      r.alertas.some((a) => a.includes('5 item(ns)') && a.includes('Outros Hospitais') && a.includes('outra') && a.includes('competência')),
    ).toBe(true);
  });

  // Achado real 2026-09-04 (conferência da competência AGOSTO, caso da Dra. Camilla): Imobilizações
  // usa a MESMA regra 3x1 do lote principal quando a especialidade é 3x1 (Ortopedista, GATE
  // 2026-08-06) — 6 atendimentos DISTINTOS (senha própria cada um) do MESMO paciente no MESMO dia
  // agrupam em teto(6/3) = 2 guias, porque o agrupamento cai pro paciente+data quando a senha não
  // se repete (`chaveAgrupamento3x1`). `Subtotal.atendimentos` precisa expor o 6 bruto ao lado do
  // 2 cobrado — sem isso, o relatório só mostrava "2 guias" e quem conferia manualmente (contando
  // os 6 atendimentos reais) não tinha como saber por que o número cobrado era menor.
  it('Imobilizações com 6 atendimentos distintos do mesmo paciente/dia → 2 guias (3x1), Subtotal.atendimentos expõe o bruto', () => {
    const itensPrincipal = Array.from({ length: 42 }, (_, i) => item(i));
    const itensImobilizacoes = Array.from({ length: 6 }, (_, i) => ({
      ...item(9000 + i),
      pacienteNome: 'Paciente Repetido',
      atendimentoExternoId: `AT-${i}`, // senha ÚNICA por linha — cai pro fallback por paciente+data
    }));

    const r = processarMedico({
      medico: {
        id: 'camilla', cpf: '00000000006', nome: 'Dra. Camilla',
        statusHapvida: 'credenciado', fazImobilizacoes: true,
        modoMudancaData: 'nao', especialidade: 'Ortopedia',
      } as any,
      itens: itensPrincipal,
      itensImobilizacoes,
    });

    const subtotalImobilizacoes = r.subtotais?.find((s) => s.classe === 'IMOBILIZACOES');
    expect(subtotalImobilizacoes).toMatchObject({ guias: 2, atendimentos: 6 });
  });
});

describe('tabelaSemExcedentePorGuia (Story 10.7 — Dr. Adilson, contrato antigo)', () => {
  it('HAPVIDA_CRED (excedente por_guia) → vira fixo no valor da última faixa', () => {
    const t = tabelaSemExcedentePorGuia(TABELA_PRECO_PADRAO.HAPVIDA_CRED);
    expect(t.excedente).toEqual({ tipo: 'fixo', valorFixo: 950.89 });
    expect(t.faixas).toBe(TABELA_PRECO_PADRAO.HAPVIDA_CRED.faixas); // faixas inalteradas
  });
  it('OUTROS_HOSPITAIS (já fixo) → idempotente, sem mudança', () => {
    const t = tabelaSemExcedentePorGuia(TABELA_PRECO_PADRAO.OUTROS_HOSPITAIS);
    expect(t).toBe(TABELA_PRECO_PADRAO.OUTROS_HOSPITAIS);
  });
});

describe('processarMedico — contrato sem excedente por guia (Story 10.7, Dr. Adilson)', () => {
  function itemSimples(id: number): ItemProducao {
    return {
      data: '2026-06-01',
      pacienteNome: `Paciente ${id}`,
      atendimentoExternoId: null,
      codigoProcedimento: '31309054',
      descricaoProcedimento: 'Procedimento teste',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: false,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 100,
      valorPagoOrigem: 100,
    };
  }

  const medicoBase = {
    id: 'adilson', cpf: '00000000006', nome: 'Dr. Adilson Pontes da Rocha Filho',
    statusHapvida: 'credenciado' as const, fazOutrosHospitais: false,
    fazImobilizacoes: false, modoMudancaData: 'nao' as const, especialidade: 'Cirurgião Geral',
    modoCobranca: 'faixa_guias' as const, percentualProducao: null, regraPreco: null,
  };

  it('200 guias, semExcedentePorGuia=false (padrão) → 950,89 + 20×6 = 1070,89 (comportamento normal)', () => {
    const r = processarMedico({
      medico: { ...medicoBase, semExcedentePorGuia: false } as any,
      itens: Array.from({ length: 200 }, (_, i) => itemSimples(i)),
    });
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 200, valor: 950.89 + 20 * 6 }),
    ]);
    expect(r.status).toBe('ok');
  });

  it('200 guias, semExcedentePorGuia=true (Dr. Adilson) → capa em 950,89, sem excedente por guia', () => {
    const r = processarMedico({
      medico: { ...medicoBase, semExcedentePorGuia: true } as any,
      itens: Array.from({ length: 200 }, (_, i) => itemSimples(i)),
    });
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 200, valor: 950.89 }),
    ]);
    expect(r.totalValor).toBeCloseTo(950.89, 2);
    expect(r.status).toBe('ok');
  });

  it('semExcedentePorGuia=true com 150 guias (dentro da faixa) → segue a MESMA tabela padrão normalmente', () => {
    const r = processarMedico({
      medico: { ...medicoBase, semExcedentePorGuia: true } as any,
      itens: Array.from({ length: 150 }, (_, i) => itemSimples(i)),
    });
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 150, valor: 775.33 }),
    ]);
  });
});

describe('classesDoMedico (porte 1:1 do Python — ver TODO §11)', () => {
  it('credenciado sem outros → [HAPVIDA_CRED]', () => {
    expect(classesDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: false, fazImobilizacoes: false })).toEqual([
      'HAPVIDA_CRED',
    ]);
  });
  it('não credenciado sem outros → [HAPVIDA_NAO_CRED]', () => {
    expect(classesDoMedico({ statusHapvida: 'nao_credenciado', fazOutrosHospitais: false, fazImobilizacoes: false })).toEqual([
      'HAPVIDA_NAO_CRED',
    ]);
  });
  it('credenciado + outros + imobilizações → 3 classes', () => {
    expect(
      classesDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: true, fazImobilizacoes: true }),
    ).toEqual(['HAPVIDA_CRED', 'OUTROS_HOSPITAIS', 'IMOBILIZACOES']);
  });
});
