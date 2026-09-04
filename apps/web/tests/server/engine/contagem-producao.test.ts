import { describe, it, expect } from 'vitest';
import type { ItemProducao } from '@cobranca/shared';
import {
  itensValidos,
  contarGuiasProducao,
  detalharContagemGuias,
  detectarModoProducao,
  consolidarProducao,
  contarConsultasProducao,
  isPediatra,
  isUrologista,
  isGinecologista,
  isOrtopedista,
  isAngiologista,
  CODIGOS_EXCECAO_UROLOGISTA,
  CODIGOS_EXCECAO_ANGIOGRAFIA,
} from '../../../src/server/engine/contagem-producao';

describe('Engine: Contagem de Produção', () => {
  const baseItem = (): ItemProducao => ({
    data: '2026-07-06',
    pacienteNome: 'João Silva',
    atendimentoExternoId: null,
    codigoProcedimento: '10101012',
    descricaoProcedimento: 'Consulta',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
  });

  describe('Casos de Ouro', () => {
    it('a. grupo viaAcesso com 3 itens mesmo paciente/data → 1 guia', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
      ];
      const resultado = contarGuiasProducao(itens, 'Clínica Médica');
      expect(resultado.guias).toBe(1);
      expect(resultado.cirurgias).toBe(1);
    });

    it('b. mesmo paciente em 2 datas com viaAcesso → 2 grupos (fallback) → 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), data: '2026-07-01', viaAcesso: true },
        { ...baseItem(), data: '2026-07-02', viaAcesso: true },
      ];
      const resultado = contarGuiasProducao(itens, 'Cirurgia');
      expect(resultado.guias).toBe(2);
      expect(resultado.cirurgias).toBe(2);
      // Detecção de modo agrupa por PACIENTE no fallback (QA M-3): mesmo paciente
      // em 2 datas → modo observado 'sim'.
      expect(detectarModoProducao(itens)).toBe('sim');
    });

    it('c. itens Glosado/Recurso/Aguardando Fechamento → contam igual a Devidamente Pago', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1', statusOrigem: 'Glosado' },
        { ...baseItem(), pacienteNome: 'P2', statusOrigem: 'Recurso' },
        { ...baseItem(), pacienteNome: 'P3', statusOrigem: 'Aguardando Fechamento' },
        { ...baseItem(), pacienteNome: 'P4', statusOrigem: 'Devidamente Pago' },
      ];
      const resultado = contarGuiasProducao(itens, 'Clínica Médica');
      // 1 guia por item para não-pediatra
      expect(resultado.guias).toBe(4);
      expect(resultado.cirurgias).toBe(0);
    });

    it('d. paciente repetido sem viaAcesso (não-pediatra) → 1 guia por item', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Clínica Médica');
      expect(resultado.guias).toBe(3);
    });

    it('e. pediatra: 4 itens sem viaAcesso, mesmo paciente/data → teto(4/3) = 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Pediatria');
      expect(resultado.guias).toBe(2); // Math.ceil(4/3)
    });

    it('f. pediatra: grupo viaAcesso (1 guia) + 2 itens soltos → 1 + teto(2/3) = 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), viaAcesso: true, pacienteNome: 'Cirurgia P1' },
        { ...baseItem(), viaAcesso: true, pacienteNome: 'Cirurgia P1' },
        { ...baseItem(), pacienteNome: 'Consulta P2' },
        { ...baseItem(), pacienteNome: 'Consulta P2' },
      ];
      const resultado = contarGuiasProducao(itens, 'Pediatra');
      // 1 guia (cirurgia P1) + teto(2/3) = 1 guia (consulta P2) => 2 guias total
      expect(resultado.guias).toBe(2);
      // Fallback gera 1 chaveAtendimento para Cirurgia P1 e 1 para Consulta P2 (ambos mesma data)
      expect(resultado.cirurgias).toBe(2);
    });

    it('g. dois atendimentos do mesmo paciente no mesmo dia com atendimentoExternoId distintos → 2 guias (e o MESMO cenário sem o campo → 1 guia, documentando a subcontagem do fallback)', () => {
      // Com atendimentoExternoId distintos:
      const itensComId: ItemProducao[] = [
        { ...baseItem(), atendimentoExternoId: 'atend-1', viaAcesso: true },
        { ...baseItem(), atendimentoExternoId: 'atend-1', viaAcesso: true },
        { ...baseItem(), atendimentoExternoId: 'atend-2', viaAcesso: true },
      ];
      const resComId = contarGuiasProducao(itensComId, 'Cirurgia');
      expect(resComId.guias).toBe(2);

      // Sem o campo (fallback vai agrupar tudo pq é mesmo paciente/data):
      const itensSemId: ItemProducao[] = [
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
      ];
      const resSemId = contarGuiasProducao(itensSemId, 'Cirurgia');
      expect(resSemId.guias).toBe(1); // subcontagem documentada
    });

    it('i. pediatra: via de acesso com senha própria por procedimento → 3x1 por paciente, não por senha (achado real 2026-08-04, Dr. José Neias, especialidade "Pediatr" truncada)', () => {
      // Réplica do caso real: 17 pacientes, cada procedimento com senha (atendimentoExternoId)
      // PRÓPRIA — 15 pacientes com ≤3 itens (1 guia cada) e 2 pacientes com 4 itens (teto(4/3)=2
      // guias cada). Total esperado: 15×1 + 2×2 = 19. Sem os dois fixes (isPediatra reconhecer
      // "Pediatr" truncado + agrupar via de acesso por paciente, não por senha), o sistema
      // cobrava 38 guias (quase o dobro do correto).
      const itens: ItemProducao[] = [];
      let senhaSeq = 0;
      const proximaSenha = () => `AJ${++senhaSeq}`;
      // 2 pacientes com 4 itens (4 senhas distintas cada) — devem virar 2 guias cada.
      for (const paciente of ['Edriana Pascoal', 'Francisco Benevaldo']) {
        for (let i = 0; i < 4; i++) {
          itens.push({ ...baseItem(), pacienteNome: paciente, viaAcesso: true, atendimentoExternoId: proximaSenha() });
        }
      }
      // 15 pacientes com 1 item cada (senha própria) — cada um deve virar 1 guia.
      for (let idx = 0; idx < 15; idx++) {
        itens.push({ ...baseItem(), pacienteNome: `Paciente ${idx}`, viaAcesso: true, atendimentoExternoId: proximaSenha() });
      }

      const resultado = contarGuiasProducao(itens, 'Pediatr');
      expect(resultado.guias).toBe(19);
    });

    it('j. pediatra: via de acesso, mesmo paciente com 4 senhas distintas → teto(4/3) = 2 guias (não 4)', () => {
      const itens: ItemProducao[] = Array.from({ length: 4 }, (_, i) => ({
        ...baseItem(),
        pacienteNome: 'Bebê Via Acesso',
        viaAcesso: true,
        atendimentoExternoId: `senha-${i}`,
      }));
      const resultado = contarGuiasProducao(itens, 'Pediatria');
      expect(resultado.guias).toBe(2);
    });

    it('k. NÃO pediatra: via de acesso com senhas distintas → continua 1 guia por senha (comportamento original preservado)', () => {
      const itens: ItemProducao[] = Array.from({ length: 4 }, (_, i) => ({
        ...baseItem(),
        pacienteNome: 'Paciente Adulto',
        viaAcesso: true,
        atendimentoExternoId: `senha-${i}`,
      }));
      const resultado = contarGuiasProducao(itens, 'Cirurgia Geral');
      expect(resultado.guias).toBe(4);
    });

    it('l. pediatra: itens NORMAIS (sem via de acesso) com senha própria por procedimento → 3x1 por paciente, não por senha (achado real 2026-08-05, Dr. Bruno de Brito Botelho)', () => {
      // Réplica simplificada do caso real: 64 pacientes, cada procedimento com senha própria —
      // 14 pacientes com 4 itens no mesmo dia (teto(4/3)=2 cada) e 50 pacientes com 1 item cada
      // (1 guia cada). Total esperado: 50×1 + 14×2 = 78. Sem o fix (agrupar por senha em vez de
      // paciente+data), cada senha vira 1 guia própria — 50+56=106 guias em vez de 78 (o caso
      // real tinha 213 itens/senhas → 80 guias corretas, aqui simplificado para números redondos).
      const itens: ItemProducao[] = [];
      let senhaSeq = 0;
      const proximaSenha = () => `AH${++senhaSeq}`;
      for (let p = 0; p < 14; p++) {
        for (let i = 0; i < 4; i++) {
          itens.push({ ...baseItem(), pacienteNome: `Paciente4x-${p}`, atendimentoExternoId: proximaSenha() });
        }
      }
      for (let p = 0; p < 50; p++) {
        itens.push({ ...baseItem(), pacienteNome: `Paciente1x-${p}`, atendimentoExternoId: proximaSenha() });
      }

      const resultado = contarGuiasProducao(itens, 'pediatria');
      expect(resultado.guias).toBe(78); // 50×1 + 14×teto(4/3)=14×2
    });

    it('m. pediatra: itens normais, mesmo paciente com 4 senhas distintas no mesmo dia → teto(4/3) = 2 guias (não 4)', () => {
      const itens: ItemProducao[] = Array.from({ length: 4 }, (_, i) => ({
        ...baseItem(),
        pacienteNome: 'Criança X',
        atendimentoExternoId: `senha-${i}`,
      }));
      const resultado = contarGuiasProducao(itens, 'Pediatria');
      expect(resultado.guias).toBe(2);
    });

    it('n. regra híbrida: senha REPETIDA (atendimento real, PRD §12) convive com senha ÚNICA por procedimento (achado 2026-08-05) no mesmo lote', () => {
      const itens: ItemProducao[] = [
        // Atendimento real: 1 cirurgia, 3 procedimentos, MESMA senha (padrão PRD §12 Dra. A/Dr. E)
        // → deve virar 1 guia (teto(3/3)), mesmo com pacienteNome genérico repetido abaixo.
        { ...baseItem(), pacienteNome: 'Paciente', atendimentoExternoId: 'ATEND-REAL-1' },
        { ...baseItem(), pacienteNome: 'Paciente', atendimentoExternoId: 'ATEND-REAL-1' },
        { ...baseItem(), pacienteNome: 'Paciente', atendimentoExternoId: 'ATEND-REAL-1' },
        // Outro paciente, 4 procedimentos NO MESMO DIA, cada um com senha PRÓPRIA (padrão José
        // Neias/Bruno Botelho) → deve cair para agrupamento por paciente: teto(4/3) = 2 guias.
        { ...baseItem(), pacienteNome: 'Outra Criança', atendimentoExternoId: 'SENHA-UNICA-1' },
        { ...baseItem(), pacienteNome: 'Outra Criança', atendimentoExternoId: 'SENHA-UNICA-2' },
        { ...baseItem(), pacienteNome: 'Outra Criança', atendimentoExternoId: 'SENHA-UNICA-3' },
        { ...baseItem(), pacienteNome: 'Outra Criança', atendimentoExternoId: 'SENHA-UNICA-4' },
      ];
      const resultado = contarGuiasProducao(itens, 'Pediatria');
      expect(resultado.guias).toBe(3); // 1 (atendimento real) + 2 (teto(4/3) por paciente)
    });

    it('h. linha sem paciente ou sem data → excluída + reportada como inválida', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem(), data: '' },
        { ...baseItem(), pacienteNome: '  ' },
        { ...baseItem(), pacienteNome: '', data: '' },
      ];
      const filtrado = itensValidos(itens);
      expect(filtrado.validos).toHaveLength(1);
      expect(filtrado.invalidos).toHaveLength(3);

      const resultado = contarGuiasProducao(itens, 'Clínica Médica');
      expect(resultado.guias).toBe(1); // Apenas a linha válida foi contada
    });
  });

  describe('detectarModoProducao', () => {
    it('detecta modo sim para a mesma chave de atendimento em múltiplas datas', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), atendimentoExternoId: 'cirurgia-123', data: '2026-07-01', viaAcesso: true },
        { ...baseItem(), atendimentoExternoId: 'cirurgia-123', data: '2026-07-02', viaAcesso: true },
      ];
      expect(detectarModoProducao(itens)).toBe('sim');
    });

    it('detecta modo nao se paciente só tem viaAcesso em uma data', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Maria', data: '2026-07-01', viaAcesso: true },
        { ...baseItem(), pacienteNome: 'Maria', data: '2026-07-01', viaAcesso: true },
      ];
      expect(detectarModoProducao(itens)).toBe('nao');
    });
    
    it('detecta por paciente no fallback mesmo sem viaAcesso (QA M-3)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Maria', data: '2026-07-01', viaAcesso: false },
        { ...baseItem(), pacienteNome: 'Maria', data: '2026-07-02', viaAcesso: false },
      ];
      expect(detectarModoProducao(itens)).toBe('sim');
    });

    it('pacientes diferentes em datas diferentes → nao (sem grupo multi-data)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Maria', data: '2026-07-01' },
        { ...baseItem(), pacienteNome: 'José', data: '2026-07-02' },
      ];
      expect(detectarModoProducao(itens)).toBe('nao');
    });

    it('atendimentoExternoId distintos do mesmo paciente em datas diferentes → nao', () => {
      // Com o campo da origem presente, dois atendimentos separados NÃO são "mudança de data".
      const itens: ItemProducao[] = [
        { ...baseItem(), atendimentoExternoId: 'at-1', data: '2026-07-01' },
        { ...baseItem(), atendimentoExternoId: 'at-2', data: '2026-07-02' },
      ];
      expect(detectarModoProducao(itens)).toBe('nao');
    });
  });

  describe('contarConsultasProducao (Story 10.2 — lote separado de consultas de pediatria)', () => {
    it('conta 1 consulta por item válido, sem agrupamento (diferente da regra teto(n/3) das guias)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1' },
        { ...baseItem(), pacienteNome: 'P2' },
        { ...baseItem(), pacienteNome: 'P3' },
      ];
      expect(contarConsultasProducao(itens)).toBe(3);
    });

    it('mesmo paciente/data repetido conta cada item — não agrupa como guia (159 consultas → 159)', () => {
      const itens: ItemProducao[] = Array.from({ length: 159 }, () => baseItem());
      expect(contarConsultasProducao(itens)).toBe(159);
    });

    it('exclui itens inválidos (sem paciente/data), mesma regra de itensValidos', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem(), data: '' },
        { ...baseItem(), pacienteNome: '' },
      ];
      expect(contarConsultasProducao(itens)).toBe(1);
    });

    it('lote vazio → 0 consultas', () => {
      expect(contarConsultasProducao([])).toBe(0);
    });
  });

  describe('consolidarProducao', () => {
    it('ignora a data no agrupamento de pacientes, consolidando tudo pelo nome', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'João', data: '2026-07-01', viaAcesso: true },
        { ...baseItem(), pacienteNome: 'João', data: '2026-07-02', viaAcesso: true }, // Mesmo paciente, outra data
      ];
      // Para a consolidação, João conta como 1 guia total (agrupado por pacienteNome)
      expect(consolidarProducao(itens)).toBe(1);
      
      // Mas para a contagem normal (fallback de atendimento), são 2 guias
      expect(contarGuiasProducao(itens).guias).toBe(2);
    });

    it('consolida corretamente para pediatras: teto(total_itens_paciente / 3)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Bebê', data: '2026-07-01', viaAcesso: false },
        { ...baseItem(), pacienteNome: 'Bebê', data: '2026-07-02', viaAcesso: false },
        { ...baseItem(), pacienteNome: 'Bebê', data: '2026-07-03', viaAcesso: false },
        { ...baseItem(), pacienteNome: 'Bebê', data: '2026-07-04', viaAcesso: false },
      ];
      // 4 procedimentos do Bebê = teto(4/3) = 2 guias consolidadas
      expect(consolidarProducao(itens, 'Pediatria')).toBe(2);
    });

    it('urologista: aplica a MESMA regra completa do valor real (exceção + teto(n/3)), GATE 2026-08-06', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Paciente Uro', data: '2026-07-01', codigoProcedimento: '3.11.02.03-4' },
        { ...baseItem(), pacienteNome: 'Paciente Uro', data: '2026-07-02' },
        { ...baseItem(), pacienteNome: 'Paciente Uro', data: '2026-07-03' },
        { ...baseItem(), pacienteNome: 'Paciente Uro', data: '2026-07-04' },
      ];
      // 1 (exceção, fora do pool) + teto(3/3)=1 (os outros 3 itens) = 2
      expect(consolidarProducao(itens, 'Urologista')).toBe(2);
    });

    it('ginecologista: aplica a MESMA regra completa do valor real (exceção por descrição + teto(n/3)), GATE 2026-08-07', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Paciente Gineco', data: '2026-07-01', descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
        { ...baseItem(), pacienteNome: 'Paciente Gineco', data: '2026-07-02' },
        { ...baseItem(), pacienteNome: 'Paciente Gineco', data: '2026-07-03' },
        { ...baseItem(), pacienteNome: 'Paciente Gineco', data: '2026-07-04' },
      ];
      // 1 (exceção, fora do pool) + teto(3/3)=1 (os outros 3 itens) = 2
      expect(consolidarProducao(itens, 'Ginecologista')).toBe(2);
    });

    it('ortopedista: teto(n/3) sem nenhuma exceção de código', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Paciente Orto', data: '2026-07-01' },
        { ...baseItem(), pacienteNome: 'Paciente Orto', data: '2026-07-02' },
        { ...baseItem(), pacienteNome: 'Paciente Orto', data: '2026-07-03' },
        { ...baseItem(), pacienteNome: 'Paciente Orto', data: '2026-07-04' },
      ];
      expect(consolidarProducao(itens, 'Ortopedista')).toBe(2); // teto(4/3) = 2
    });
  });

  describe('Urologista (3x1 + exceção de códigos, GATE 2026-08-06)', () => {
    // Cateterismo ureteral unilateral — está em CODIGOS_EXCECAO_UROLOGISTA.
    const CODIGO_EXCECAO_1 = '3.11.02.03-4';
    // Intra-operatório — está em CODIGOS_EXCECAO_UROLOGISTA.
    const CODIGO_EXCECAO_2 = '4.09.02.05-6';

    it('sem nenhum código de exceção, 4 itens normais mesmo paciente/data → teto(4/3) = 2 guias (igual pediatra)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Urologista');
      expect(resultado.guias).toBe(2);
    });

    it('1 item de código de exceção + 2 itens normais no mesmo grupo → 1 (exceção) + teto(2/3)=1 = 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Urologia');
      expect(resultado.guias).toBe(2);
    });

    it('3 ocorrências do MESMO código de exceção, mesmo paciente/data → 3 guias (não colapsa, cada uma é individual)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_1 },
      ];
      const resultado = contarGuiasProducao(itens, 'Urologista');
      expect(resultado.guias).toBe(3);
    });

    it('ramo viaAcesso: código de exceção também fica fora do pool 3x1 nesse ramo', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), viaAcesso: true, codigoProcedimento: CODIGO_EXCECAO_2 },
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
      ];
      const resultado = contarGuiasProducao(itens, 'Urologista');
      // 1 (exceção) + teto(2/3)=1 (via de acesso normal) = 2
      expect(resultado.guias).toBe(2);
    });

    it('médico não-urologista/não-pediatra com item de código de exceção → não afetado, 1 guia por item', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1', codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem(), pacienteNome: 'P2' },
      ];
      const resultado = contarGuiasProducao(itens, 'Cirurgia Geral');
      expect(resultado.guias).toBe(2);
    });

    it('pediatra com item de código de exceção do urologista → continua 3x1 normal, sem exceção (exceção é exclusiva de urologista)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      // teto(4/3) = 2 — o código de exceção do urologista não isola nada para pediatra.
      const resultado = contarGuiasProducao(itens, 'Pediatria');
      expect(resultado.guias).toBe(2);
    });

    it('caso misto: via de acesso + itens normais + exceções nos dois ramos + múltiplas datas', () => {
      const itens: ItemProducao[] = [
        // Via de acesso: 1 exceção + 3 normais (mesmo paciente/data) → 1 + teto(3/3)=1 = 2
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true, codigoProcedimento: CODIGO_EXCECAO_2 },
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
        // Normais: 2 exceções (mesmo código, mesmo paciente/data) + 4 normais → 2 + teto(4/3)=2 = 4
        { ...baseItem(), pacienteNome: 'Paciente Normal', codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem(), pacienteNome: 'Paciente Normal', codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
      ];
      const resultado = contarGuiasProducao(itens, 'Urologista');
      expect(resultado.guias).toBe(6); // 2 (via de acesso) + 4 (normais)
    });

    it('métrica "cirurgias" passa a aparecer para urologista mesmo sem itens via de acesso (GATE 2026-08-06)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1' },
        { ...baseItem(), pacienteNome: 'P2' },
      ];
      const resultado = contarGuiasProducao(itens, 'Urologista');
      expect(resultado.cirurgias).toBe(2);
    });
  });

  describe('isUrologista', () => {
    it('reconhece "Urologia", "Urologista" e o caso combinado real "Cirurgião Geral / Urologista"', () => {
      expect(isUrologista('Urologia')).toBe(true);
      expect(isUrologista('Urologista')).toBe(true);
      expect(isUrologista('urologista')).toBe(true);
      expect(isUrologista('Cirurgião Geral / Urologista')).toBe(true);
    });

    it('não reconhece especialidades sem relação, null ou vazio', () => {
      expect(isUrologista('Cirurgia Geral')).toBe(false);
      expect(isUrologista(null)).toBe(false);
      expect(isUrologista(undefined)).toBe(false);
      expect(isUrologista('')).toBe(false);
    });
  });

  describe('Ginecologista (3x1 + exceção por DESCRIÇÃO, GATE 2026-08-07)', () => {
    // Qualquer variante de DIU (a origem tem 5+ códigos TUSS diferentes pra essa MESMA
    // descrição genérica — inserção/remoção/hormonal/não hormonal, achado real Dr. Márcio
    // Erlon Fontinele Moreira) — detecta por descrição, não por código.
    const DESCRICAO_DIU = 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)';
    // Qualquer histeroscopia (cirúrgica ou diagnóstica, confirmado pelo usuário) — a
    // coordenadora inicialmente falou "histerectomia" por engano; a regra real é histeroscopia.
    const DESCRICAO_HISTEROSCOPIA = 'Histeroscopia cirúrgica p/ biópsia dirigida, lise de sinéquias, retirada de corpo estranho';

    it('sem nenhuma descrição de exceção, 4 itens normais mesmo paciente/data → teto(4/3) = 2 guias (igual pediatra/urologista)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(2);
    });

    it('1 item de exceção (DIU) + 2 itens normais no mesmo grupo → 1 (exceção) + teto(2/3)=1 = 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: DESCRICAO_DIU },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologia');
      expect(resultado.guias).toBe(2);
    });

    it('3 ocorrências da MESMA descrição de exceção, mesmo paciente/data → 3 guias (não colapsa, cada uma é individual)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: DESCRICAO_HISTEROSCOPIA },
        { ...baseItem(), descricaoProcedimento: DESCRICAO_HISTEROSCOPIA },
        { ...baseItem(), descricaoProcedimento: DESCRICAO_HISTEROSCOPIA },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(3);
    });

    it('ramo viaAcesso: descrição de exceção também fica fora do pool 3x1 nesse ramo', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), viaAcesso: true, descricaoProcedimento: DESCRICAO_DIU },
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      // 1 (exceção) + teto(2/3)=1 (via de acesso normal) = 2
      expect(resultado.guias).toBe(2);
    });

    it('médico não-ginecologista/não-3x1 com item de descrição de exceção do ginecologista → não afetado, 1 guia por item', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1', descricaoProcedimento: DESCRICAO_DIU },
        { ...baseItem(), pacienteNome: 'P2' },
      ];
      const resultado = contarGuiasProducao(itens, 'Cirurgia Geral');
      expect(resultado.guias).toBe(2);
    });

    it('urologista com item de descrição de exceção do ginecologista → continua 3x1 normal, sem exceção (regras são exclusivas por especialidade)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: DESCRICAO_DIU },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      // teto(4/3) = 2 — a descrição de exceção do ginecologista não isola nada para urologista
      // (urologista só olha código, nunca descrição — ver `ehExcecao`).
      const resultado = contarGuiasProducao(itens, 'Urologista');
      expect(resultado.guias).toBe(2);
    });

    it('histerectomia NÃO é exceção — entra no pool 3x1 normal (correção da coordenadora, 2026-08-07: ela tinha dito "histerectomia", era "histeroscopia")', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: 'Histerectomia total com anexectomia uni ou bilateral (via alta ou baixa)' },
        { ...baseItem(), descricaoProcedimento: 'Histerectomia total com anexectomia uni ou bilateral (via alta ou baixa)' },
        { ...baseItem(), descricaoProcedimento: 'Histerectomia total com anexectomia uni ou bilateral (via alta ou baixa)' },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(1); // teto(3/3) = 1 — não é exceção, entrou no pool
    });

    it('histeroscopia DIAGNÓSTICA também é exceção, não só a cirúrgica (confirmado pelo usuário)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: 'Histeroscopia diagnóstica' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(2); // 1 (exceção) + teto(2/3)=1
    });

    it('detecção por descrição é case-insensitive', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: 'implante de diu não hormonal - inserção' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(2); // 1 (exceção) + teto(2/3)=1
    });

    it('caso misto: via de acesso + itens normais + exceções nos dois ramos + múltiplas datas', () => {
      const itens: ItemProducao[] = [
        // Via de acesso: 1 exceção + 3 normais (mesmo paciente/data) → 1 + teto(3/3)=1 = 2
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true, descricaoProcedimento: DESCRICAO_HISTEROSCOPIA },
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
        { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
        // Normais: 2 exceções (mesma descrição, mesmo paciente/data) + 4 normais → 2 + teto(4/3)=2 = 4
        { ...baseItem(), pacienteNome: 'Paciente Normal', descricaoProcedimento: DESCRICAO_DIU },
        { ...baseItem(), pacienteNome: 'Paciente Normal', descricaoProcedimento: DESCRICAO_DIU },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
        { ...baseItem(), pacienteNome: 'Paciente Normal' },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(6); // 2 (via de acesso) + 4 (normais)
    });

    it('métrica "cirurgias" aparece para ginecologista mesmo sem itens via de acesso', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1' },
        { ...baseItem(), pacienteNome: 'P2' },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.cirurgias).toBe(2);
    });
  });

  describe('isGinecologista', () => {
    it('reconhece "Ginecologia", "Ginecologista" e "Ginecologia e Obstetrícia"', () => {
      expect(isGinecologista('Ginecologia')).toBe(true);
      expect(isGinecologista('Ginecologista')).toBe(true);
      expect(isGinecologista('ginecologista')).toBe(true);
      expect(isGinecologista('Ginecologia e Obstetrícia')).toBe(true);
    });

    it('não reconhece especialidades sem relação, null ou vazio', () => {
      expect(isGinecologista('Obstetrícia')).toBe(false);
      expect(isGinecologista('Cirurgia Geral')).toBe(false);
      expect(isGinecologista(null)).toBe(false);
      expect(isGinecologista(undefined)).toBe(false);
      expect(isGinecologista('')).toBe(false);
    });
  });

  describe('Ortopedista (3x1 sem exceção, GATE 2026-08-06)', () => {
    it('teto(n/3) aplica normalmente, igual pediatra/urologista/ginecologista', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Ortopedista');
      expect(resultado.guias).toBe(2); // teto(4/3) = 2
    });

    it('não tem lista de exceção: uma descrição que seria exceção pra ginecologista (DIU) entra no pool normalmente', () => {
      // Mesma descrição nos 3 itens (só o que muda é a especialidade não ter exceção) —
      // descrição diferente entre itens do mesmo paciente/data forma grupos separados desde o
      // achado 2026-08-06 (Dr. Jansen Osterno), o que testaria outra coisa aqui.
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' }, // exceção só de ginecologista
        { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
        { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
      ];
      const resultado = contarGuiasProducao(itens, 'Ortopedia');
      // teto(3/3) = 1 — nenhum item é retirado do pool (ortopedista não tem exceção)
      expect(resultado.guias).toBe(1);
    });

    it('ramo viaAcesso também usa teto(n/3), sem exceção', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
      ];
      const resultado = contarGuiasProducao(itens, 'Ortopedista');
      expect(resultado.guias).toBe(2); // teto(4/3) = 2
    });

    it('métrica "cirurgias" aparece para ortopedista mesmo sem itens via de acesso', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1' },
        { ...baseItem(), pacienteNome: 'P2' },
      ];
      const resultado = contarGuiasProducao(itens, 'Ortopedista');
      expect(resultado.cirurgias).toBe(2);
    });
  });

  describe('isOrtopedista', () => {
    it('reconhece "Ortopedia", "Ortopedista" e "Ortopedia e Traumatologia"', () => {
      expect(isOrtopedista('Ortopedia')).toBe(true);
      expect(isOrtopedista('Ortopedista')).toBe(true);
      expect(isOrtopedista('ortopedista')).toBe(true);
      expect(isOrtopedista('Ortopedia e Traumatologia')).toBe(true);
    });

    it('não reconhece especialidades sem relação, null ou vazio', () => {
      expect(isOrtopedista('Cirurgia Geral')).toBe(false);
      expect(isOrtopedista(null)).toBe(false);
      expect(isOrtopedista(undefined)).toBe(false);
      expect(isOrtopedista('')).toBe(false);
    });
  });

  describe('isAngiologista', () => {
    it('reconhece "Angiologia" e "Angiologista"', () => {
      expect(isAngiologista('Angiologia')).toBe(true);
      expect(isAngiologista('Angiologista')).toBe(true);
      expect(isAngiologista('angiologista')).toBe(true);
    });

    it('não reconhece especialidades sem relação, null ou vazio', () => {
      expect(isAngiologista('Cirurgia Geral')).toBe(false);
      expect(isAngiologista(null)).toBe(false);
      expect(isAngiologista(undefined)).toBe(false);
      expect(isAngiologista('')).toBe(false);
    });
  });

  describe('Angiografia — 3x1 + exceção Intra-operatório (GATE 2026-08-07)', () => {
    // Reusa contarGuiasProducao com especialidade='Angiologista' — é a MESMA função usada por
    // todo mundo (usaRegra3x1/ehExcecao já incluem angiologista), não uma regra paralela. O
    // lote de Angiografia do processarAngiologista chama exatamente esse caminho.
    it('sem exceção, 4 itens normais mesmo paciente/data → teto(4/3) = 2 guias (igual às outras especialidades 3x1)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Angiologista');
      expect(resultado.guias).toBe(2);
    });

    it('1 Intra-operatório (exceção) + 2 itens normais no mesmo grupo → 1 (exceção) + teto(2/3)=1 = 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Angiologista');
      expect(resultado.guias).toBe(2);
    });

    it('3 ocorrências de Intra-operatório, mesmo paciente/data → 3 guias (não colapsa, cada uma é individual)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
        { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
        { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
      ];
      const resultado = contarGuiasProducao(itens, 'Angiologista');
      expect(resultado.guias).toBe(3);
    });

    it('código de exceção no formato CRU da API (sem pontuação) ainda é reconhecido', () => {
      const cru = [...CODIGOS_EXCECAO_ANGIOGRAFIA][0]!.replace(/\D/g, '');
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: cru },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Angiologista').guias;
      expect(resultado).toBe(2);
    });

    it('urologista com o mesmo código de Intra-operatório (também é exceção pra ele) → continua reconhecendo (listas coincidem por conteúdo, mas são constantes independentes)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      expect(contarGuiasProducao(itens, 'Urologista').guias).toBe(2);
    });
  });

  describe('isPediatra', () => {
    it('reconhece "Pediatra" e "Pediatria" (grafias completas)', () => {
      expect(isPediatra('Pediatra')).toBe(true);
      expect(isPediatra('Pediatria')).toBe(true);
      expect(isPediatra('pediatra')).toBe(true);
    });

    it('reconhece "Pediatr" truncado (achado real 2026-08-04, Dr. José Neias) e outras variações com o prefixo', () => {
      expect(isPediatra('Pediatr')).toBe(true);
      expect(isPediatra('Pediatra Neonatal')).toBe(true);
      expect(isPediatra('Cirurgia Pediátrica')).toBe(false); // "pediátrica" com acento não bate no prefixo ascii "pediatr"
    });

    it('não reconhece especialidades sem relação, null ou vazio', () => {
      expect(isPediatra('Cirurgia Geral')).toBe(false);
      expect(isPediatra(null)).toBe(false);
      expect(isPediatra(undefined)).toBe(false);
      expect(isPediatra('')).toBe(false);
    });
  });

  describe('Exceção — cobertura individual e precedência (achados do QA 2026-08-06 e da correção da coordenadora 2026-08-07)', () => {
    // Table-driven: cada código de CODIGOS_EXCECAO_UROLOGISTA precisa ser exercitado
    // individualmente — um typo em qualquer um passaria batido nos testes "de caso misto" acima,
    // que não cobrem os 6 códigos do urologista.
    it.each([...CODIGOS_EXCECAO_UROLOGISTA].map((codigo) => [codigo]))(
      'código de exceção do urologista "%s" isolado: 1 ocorrência + 2 itens normais → 1 + teto(2/3)=1 = 2 guias',
      (codigo) => {
        const itens: ItemProducao[] = [
          { ...baseItem(), codigoProcedimento: codigo },
          { ...baseItem() },
          { ...baseItem() },
        ];
        expect(contarGuiasProducao(itens, 'Urologista').guias).toBe(2);
      },
    );

    // Ginecologista detecta por DESCRIÇÃO (não por código fixo, GATE 2026-08-07) — table-driven
    // com variações reais de texto (inserção/remoção, hormonal/não hormonal, cirúrgica/
    // diagnóstica) pra garantir que nenhum subtipo escapa da regra "contém diu OU histeroscopia".
    it.each([
      'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)',
      'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU) HORMONAL - INSERCAO',
      'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU) NAO HORMONAL - INSERCAO',
      'RETIRADA DE DISPOSITIVO INTRA-UTERINO (DIU)',
      'Histeroscopia cirúrgica p/ biópsia dirigida, lise de sinéquias, retirada de corpo estranho',
      'Histeroscopia diagnóstica',
    ])('descrição de exceção do ginecologista "%s" isolada: 1 ocorrência + 2 itens normais → 1 + teto(2/3)=1 = 2 guias', (descricao) => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: descricao },
        { ...baseItem() },
        { ...baseItem() },
      ];
      expect(contarGuiasProducao(itens, 'Ginecologista').guias).toBe(2);
    });

    // Contra-prova da auditoria 2026-09-02: a checagem era `descricao.includes('diu')`, que casava
    // DENTRO de outras palavras ("DIURESE", "DIURÉTICO"). Cada falso positivo errava DUAS vezes —
    // tirava o item do pool 3x1 E somava 1 guia cheia extra. Agora exige "diu" como palavra.
    it.each([
      'CONTROLE DE DIURESE',
      'DIURESE',
      'Diurese de 24 horas',
      'ADMINISTRACAO DE DIURETICO',
      'Diurético endovenoso',
    ])(
      'descrição "%s" NÃO é exceção do ginecologista — 3 itens do mesmo atendimento = teto(3/3) = 1 guia',
      (descricao) => {
        const itens: ItemProducao[] = [
          { ...baseItem(), descricaoProcedimento: descricao },
          { ...baseItem() },
          { ...baseItem() },
        ];
        expect(contarGuiasProducao(itens, 'Ginecologista').guias).toBe(1);
      },
    );

    it('"diu" isolado continua sendo exceção em grafias sem parênteses ("DIU DE COBRE")', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: 'DIU DE COBRE' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      expect(contarGuiasProducao(itens, 'Ginecologista').guias).toBe(2);
    });

    it('mistura real: 1 DIU (exceção) + 1 DIURESE (pool) + 2 normais → 1 + teto(3/3) = 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
        { ...baseItem(), descricaoProcedimento: 'CONTROLE DE DIURESE' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      expect(contarGuiasProducao(itens, 'Ginecologista').guias).toBe(2);
    });

    it('.trim() defensivo (urologista): código de exceção com espaços ao redor ainda é reconhecido (mapper de origem não trima proc_code)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: ' 3.11.02.03-4 ' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      expect(contarGuiasProducao(itens, 'Urologista').guias).toBe(2);
    });

    // BUG REAL 2026-08-06: a API do sistema web manda `proc_code` SEM pontuação ("31102034"),
    // não no formato TUSS documentado na constante ("3.11.02.03-4") — a comparação direta nunca
    // batia, nenhuma exceção era reconhecida. `normalizarCodigo` (dígitos puros dos dois lados)
    // resolve isso — estes testes usam o formato CRU real, não o TUSS.
    it.each([...CODIGOS_EXCECAO_UROLOGISTA].map((codigo) => [codigo, codigo.replace(/\D/g, '')]))(
      'código de exceção do urologista "%s" no formato CRU da API ("%s", sem pontuação) ainda é reconhecido',
      (_tuss, cru) => {
        const itens: ItemProducao[] = [
          { ...baseItem(), codigoProcedimento: cru },
          { ...baseItem() },
          { ...baseItem() },
        ];
        expect(contarGuiasProducao(itens, 'Urologista').guias).toBe(2);
      },
    );

    it('reprodução do caso real do Dr. Márcio (achado 2026-08-06/07): 15 itens de exceção (descrição DIU/histeroscopia) + 6 no pool 3x1 → 17 guias', () => {
      const itens: ItemProducao[] = [
        ...Array.from({ length: 5 }, (_, i) => ({ ...baseItem(), pacienteNome: `DIU-${i}`, descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' })),
        ...Array.from({ length: 5 }, (_, i) => ({ ...baseItem(), pacienteNome: `DIU2-${i}`, descricaoProcedimento: 'RETIRADA DE DISPOSITIVO INTRA-UTERINO (DIU)' })),
        ...Array.from({ length: 5 }, (_, i) => ({ ...baseItem(), pacienteNome: `HISTERO-${i}`, descricaoProcedimento: 'Histeroscopia cirúrgica p/ biópsia dirigida' })),
        // 6 itens normais do mesmo paciente/data → teto(6/3) = 2 guias no pool.
        { ...baseItem(), pacienteNome: 'Normal' },
        { ...baseItem(), pacienteNome: 'Normal' },
        { ...baseItem(), pacienteNome: 'Normal' },
        { ...baseItem(), pacienteNome: 'Normal' },
        { ...baseItem(), pacienteNome: 'Normal' },
        { ...baseItem(), pacienteNome: 'Normal' },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      // 15 (exceção, 1 cada) + 2 (pool: teto(6/3)) = 17 — NUNCA 6 (que seria o resultado do bug,
      // com os 15 itens de exceção diluídos no pool junto dos 6 normais: teto(21/3) = 7).
      expect(resultado.guias).toBe(17);
    });

    it('PRECEDÊNCIA (decisão de implementação, sem caso real conhecido): especialidade que bate com urologista E ginecologista ao mesmo tempo usa a regra do UROLOGISTA (por código) — a regra do ginecologista (por descrição) nem chega a ser avaliada', () => {
      const itens: ItemProducao[] = [
        // Descrição bateria como exceção pra ginecologista, mas a especialidade combinada usa a
        // regra do urologista (por código) — a descrição é ignorada por completo.
        { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
        { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
        { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
      ];
      // Se a precedência mudar (união, ou ginecologista primeiro), este teste deve ser
      // atualizado deliberadamente — não é um comportamento especificado pelo usuário.
      const resultado = contarGuiasProducao(itens, 'Ginecologia e Urologia');
      expect(resultado.guias).toBe(1); // teto(3/3)=1 — foi pro pool, a regra do urologista "venceu" e não reconhece por descrição
    });
  });

  describe('detalharContagemGuias — equivalência estrutural (auditoria 3x1, achado 2026-09-04)', () => {
    // Dra. Emilie: contagem manual deu 59, sistema deu 69, segunda conferência manual deu 61 —
    // divergência real sem forma de ver ONDE o agrupamento discordava item a item. A planilha de
    // auditoria exportável (auditoria-3x1-excel.ts) é construída sobre `detalharContagemGuias`
    // em vez de reimplementar o agrupamento — estes testes garantem que ela NUNCA pode divergir
    // do valor cobrado por `contarGuiasProducao`.
    function guiasDoDetalhe(itens: ItemProducao[], especialidade?: string | null): number {
      const { itensDetalhados } = detalharContagemGuias(itens, especialidade);
      const guiasPorGrupo = new Map<string, number>();
      for (const d of itensDetalhados) {
        if (!guiasPorGrupo.has(d.grupoId)) guiasPorGrupo.set(d.grupoId, d.guiasDoGrupo);
      }
      let total = 0;
      for (const g of guiasPorGrupo.values()) total += g;
      return total;
    }

    const FIXTURES: Array<{ nome: string; itens: ItemProducao[]; especialidade?: string | null }> = [
      {
        nome: 'pediatra: via de acesso 1x + normais 1x, múltiplos grupos',
        itens: [
          { ...baseItem(), viaAcesso: true, pacienteNome: 'Cirurgia P1' },
          { ...baseItem(), viaAcesso: true, pacienteNome: 'Cirurgia P1' },
          { ...baseItem(), pacienteNome: 'Consulta P2' },
          { ...baseItem(), pacienteNome: 'Consulta P2' },
        ],
        especialidade: 'Pediatra',
      },
      {
        nome: 'urologista: exceção + via de acesso + normais, múltiplas datas',
        itens: [
          { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true, codigoProcedimento: '4.09.02.05-6' },
          { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
          { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
          { ...baseItem(), pacienteNome: 'Paciente Via', viaAcesso: true },
          { ...baseItem(), pacienteNome: 'Paciente Normal', codigoProcedimento: '3.11.02.03-4' },
          { ...baseItem(), pacienteNome: 'Paciente Normal', codigoProcedimento: '3.11.02.03-4' },
          { ...baseItem(), pacienteNome: 'Paciente Normal' },
          { ...baseItem(), pacienteNome: 'Paciente Normal' },
        ],
        especialidade: 'Urologista',
      },
      {
        nome: 'ginecologista: exceção por descrição + normais',
        itens: [
          { ...baseItem(), descricaoProcedimento: 'IMPLANTE DE DISPOSITIVO INTRA-UTERINO (DIU)' },
          { ...baseItem(), descricaoProcedimento: 'CONTROLE DE DIURESE' },
          { ...baseItem() },
          { ...baseItem() },
        ],
        especialidade: 'Ginecologista',
      },
      {
        nome: 'ortopedista: sem exceção, teto(n/3) puro',
        itens: [{ ...baseItem() }, { ...baseItem() }, { ...baseItem() }, { ...baseItem() }],
        especialidade: 'Ortopedista',
      },
      {
        nome: 'angiologista (angiografia): exceção Intra-operatório repetida (nunca colapsa)',
        itens: [
          { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
          { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
          { ...baseItem(), codigoProcedimento: '4.09.02.05-6' },
        ],
        especialidade: 'Angiologista',
      },
      {
        nome: 'não-3x1: via de acesso agrupa por chaveAtendimento (1 guia por grupo, não por item)',
        itens: [
          { ...baseItem(), viaAcesso: true, atendimentoExternoId: 'at-1' },
          { ...baseItem(), viaAcesso: true, atendimentoExternoId: 'at-1' },
          { ...baseItem(), viaAcesso: true, atendimentoExternoId: 'at-2' },
        ],
        especialidade: 'Cirurgia Geral',
      },
      {
        nome: 'não-3x1: itens normais, 1 guia por item, sem especialidade nenhuma',
        itens: [{ ...baseItem(), pacienteNome: 'P1' }, { ...baseItem(), pacienteNome: 'P2' }],
        especialidade: undefined,
      },
      {
        nome: 'itens inválidos misturados (sem paciente/data) — não entram no detalhe nem na contagem',
        itens: [
          { ...baseItem() },
          { ...baseItem(), data: '' },
          { ...baseItem(), pacienteNome: '' },
        ],
        especialidade: 'Pediatria',
      },
      { nome: 'lote vazio', itens: [], especialidade: 'Pediatria' },
    ];

    it.each(FIXTURES.map((f) => [f.nome, f.itens, f.especialidade] as const))(
      '%s: soma de guiasDoGrupo por grupoId único === contarGuiasProducao(...).guias',
      (_nome, itens, especialidade) => {
        expect(guiasDoDetalhe(itens, especialidade)).toBe(contarGuiasProducao(itens, especialidade).guias);
      },
    );

    it('todo item de entrada aparece em exatamente um lugar: itensDetalhados OU itensInvalidos, nunca os dois nem nenhum', () => {
      for (const { itens, especialidade } of FIXTURES) {
        const { itensDetalhados, itensInvalidos } = detalharContagemGuias(itens, especialidade);
        expect(itensDetalhados.length + itensInvalidos.length).toBe(itens.length);
        const indicesDetalhados = new Set(itensDetalhados.map((d) => d.indiceOriginal));
        expect(indicesDetalhados.size).toBe(itensDetalhados.length); // nenhum índice duplicado
      }
    });

    it('itens do mesmo grupo (mesmo grupoId) sempre têm o mesmo grupoSequencia e guiasDoGrupo', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Bebê', atendimentoExternoId: 'senha-1' },
        { ...baseItem(), pacienteNome: 'Bebê', atendimentoExternoId: 'senha-1' },
        { ...baseItem(), pacienteNome: 'Bebê', atendimentoExternoId: 'senha-1' },
      ];
      const { itensDetalhados } = detalharContagemGuias(itens, 'Pediatria');
      expect(itensDetalhados).toHaveLength(3);
      const [primeiro, ...resto] = itensDetalhados;
      for (const d of resto) {
        expect(d.grupoId).toBe(primeiro!.grupoId);
        expect(d.grupoSequencia).toBe(primeiro!.grupoSequencia);
        expect(d.guiasDoGrupo).toBe(primeiro!.guiasDoGrupo);
      }
      expect(primeiro!.guiasDoGrupo).toBe(1); // teto(3/3) = 1
    });

    it('exceção nunca compartilha grupoId entre itens, mesmo com paciente/data/código idênticos', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: '3.11.02.03-4' },
        { ...baseItem(), codigoProcedimento: '3.11.02.03-4' },
        { ...baseItem(), codigoProcedimento: '3.11.02.03-4' },
      ];
      const { itensDetalhados } = detalharContagemGuias(itens, 'Urologista');
      expect(itensDetalhados).toHaveLength(3);
      const grupoIds = itensDetalhados.map((d) => d.grupoId);
      expect(new Set(grupoIds).size).toBe(3); // todos distintos
      for (const d of itensDetalhados) {
        expect(d.ramo).toBe('excecao');
        expect(d.guiasDoGrupo).toBe(1);
      }
    });

    it('grupoSequencia é determinístico e segue a ordem de PRIMEIRA OCORRÊNCIA do grupo (pacientes intercalados)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1' },
        { ...baseItem(), pacienteNome: 'P2' },
        { ...baseItem(), pacienteNome: 'P1' }, // 2ª ocorrência do grupo P1 — mesma sequência da 1ª
        { ...baseItem(), pacienteNome: 'P3' },
        { ...baseItem(), pacienteNome: 'P2' }, // 2ª ocorrência do grupo P2
      ];
      const { itensDetalhados } = detalharContagemGuias(itens, undefined); // não-3x1: 1 item = 1 guia, sem grupo real, mas grupoId ainda é por índice — usa fixture 3x1 abaixo pra testar sequência de grupo de verdade
      expect(itensDetalhados).toHaveLength(5);

      const itensViaAcesso: ItemProducao[] = itens.map((i) => ({ ...i, viaAcesso: true, atendimentoExternoId: null }));
      const { itensDetalhados: comGrupo } = detalharContagemGuias(itensViaAcesso, 'Cirurgia Geral'); // não-3x1, viaAcesso agrupa por chaveAtendimento (paciente|data aqui)
      const porPaciente = new Map(comGrupo.map((d) => [d.item.pacienteNome, d.grupoSequencia]));
      expect(porPaciente.get('P1')).toBe(1);
      expect(porPaciente.get('P2')).toBe(2);
      expect(porPaciente.get('P3')).toBe(3);
      // Roda de novo (mesma entrada) — determinístico.
      const { itensDetalhados: comGrupoDeNovo } = detalharContagemGuias(itensViaAcesso, 'Cirurgia Geral');
      expect(comGrupoDeNovo.map((d) => d.grupoSequencia)).toEqual(comGrupo.map((d) => d.grupoSequencia));
    });
  });
});
