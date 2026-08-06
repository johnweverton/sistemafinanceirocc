import { describe, it, expect } from 'vitest';
import type { ItemProducao } from '@cobranca/shared';
import {
  itensValidos,
  contarGuiasProducao,
  detectarModoProducao,
  consolidarProducao,
  contarConsultasProducao,
  isPediatra,
  isUrologista,
  isGinecologista,
  isOrtopedista,
  CODIGOS_EXCECAO_UROLOGISTA,
  CODIGOS_EXCECAO_GINECOLOGISTA,
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

    it('ginecologista: aplica a MESMA regra completa do valor real (exceção + teto(n/3)), GATE 2026-08-06', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Paciente Gineco', data: '2026-07-01', codigoProcedimento: '3.13.03.29-3' },
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

  describe('Ginecologista (3x1 + exceção de códigos, GATE 2026-08-06)', () => {
    // Implante de DIU hormonal — inserção — está em CODIGOS_EXCECAO_GINECOLOGISTA.
    const CODIGO_EXCECAO_1 = '3.13.03.29-3';
    // Histeroscopia cirúrgica p/ biópsia dirigida, lise de sinéquias, retirada de corpo estranho — está em CODIGOS_EXCECAO_GINECOLOGISTA.
    const CODIGO_EXCECAO_2 = '3.13.03.17-0';

    it('sem nenhum código de exceção, 4 itens normais mesmo paciente/data → teto(4/3) = 2 guias (igual pediatra/urologista)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(2);
    });

    it('1 item de código de exceção + 2 itens normais no mesmo grupo → 1 (exceção) + teto(2/3)=1 = 2 guias', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem() },
        { ...baseItem() },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologia');
      expect(resultado.guias).toBe(2);
    });

    it('3 ocorrências do MESMO código de exceção, mesmo paciente/data → 3 guias (não colapsa, cada uma é individual)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_2 },
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_2 },
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_2 },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      expect(resultado.guias).toBe(3);
    });

    it('ramo viaAcesso: código de exceção também fica fora do pool 3x1 nesse ramo', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), viaAcesso: true, codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem(), viaAcesso: true },
        { ...baseItem(), viaAcesso: true },
      ];
      const resultado = contarGuiasProducao(itens, 'Ginecologista');
      // 1 (exceção) + teto(2/3)=1 (via de acesso normal) = 2
      expect(resultado.guias).toBe(2);
    });

    it('médico não-ginecologista/não-3x1 com item de código de exceção do ginecologista → não afetado, 1 guia por item', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'P1', codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem(), pacienteNome: 'P2' },
      ];
      const resultado = contarGuiasProducao(itens, 'Cirurgia Geral');
      expect(resultado.guias).toBe(2);
    });

    it('urologista com item de código de exceção do ginecologista → continua 3x1 normal, sem exceção (listas são exclusivas por especialidade)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: CODIGO_EXCECAO_1 },
        { ...baseItem() },
        { ...baseItem() },
        { ...baseItem() },
      ];
      // teto(4/3) = 2 — o código de exceção do ginecologista não isola nada para urologista.
      const resultado = contarGuiasProducao(itens, 'Urologista');
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

    it('não tem lista de exceção: um código que seria exceção pra urologista/ginecologista entra no pool normalmente', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: '3.13.03.29-3' }, // exceção só de ginecologista
        { ...baseItem() },
        { ...baseItem() },
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

  describe('Códigos de exceção — cobertura individual e precedência (achados do QA, 2026-08-06)', () => {
    // Table-driven: cada código de CODIGOS_EXCECAO_UROLOGISTA/GINECOLOGISTA precisa ser
    // exercitado individualmente — um typo em qualquer um passaria batido nos testes "de caso
    // misto" acima, que não cobrem os 6 códigos do urologista nem o '3.13.03.26-9' (DIU não
    // hormonal) do ginecologista.
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

    it.each([...CODIGOS_EXCECAO_GINECOLOGISTA].map((codigo) => [codigo]))(
      'código de exceção do ginecologista "%s" isolado: 1 ocorrência + 2 itens normais → 1 + teto(2/3)=1 = 2 guias',
      (codigo) => {
        const itens: ItemProducao[] = [
          { ...baseItem(), codigoProcedimento: codigo },
          { ...baseItem() },
          { ...baseItem() },
        ];
        expect(contarGuiasProducao(itens, 'Ginecologista').guias).toBe(2);
      },
    );

    it('.trim() defensivo: código de exceção com espaços ao redor ainda é reconhecido (mapper de origem não trima proc_code)', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: ' 3.13.03.29-3 ' },
        { ...baseItem() },
        { ...baseItem() },
      ];
      expect(contarGuiasProducao(itens, 'Ginecologista').guias).toBe(2);
    });

    it('PRECEDÊNCIA (decisão de implementação, sem caso real conhecido): especialidade que bate com urologista E ginecologista ao mesmo tempo usa a lista do UROLOGISTA — a do ginecologista é ignorada, nunca há união', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), codigoProcedimento: '3.13.03.29-3' }, // exceção só na lista do ginecologista
        { ...baseItem() },
        { ...baseItem() },
      ];
      // Se a precedência mudar (união, ou ginecologista primeiro), este teste deve ser
      // atualizado deliberadamente — não é um comportamento especificado pelo usuário.
      const resultado = contarGuiasProducao(itens, 'Ginecologia e Urologia');
      expect(resultado.guias).toBe(1); // teto(3/3)=1 — código foi pro pool, lista do urologista "venceu" e não reconhece esse código
    });
  });
});
