import { describe, it, expect } from 'vitest';
import type { ItemProducao } from '@cobranca/shared';
import {
  itensValidos,
  contarGuiasProducao,
  detectarModoProducao,
  consolidarProducao,
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
      // Fallback usa (paciente + data) como chave. Portanto, as chaves são distintas e não compartilham data.
      expect(detectarModoProducao(itens)).toBe('nao');
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
    
    it('ignora itens que nao sao viaAcesso para deteccao de modo', () => {
      const itens: ItemProducao[] = [
        { ...baseItem(), pacienteNome: 'Maria', data: '2026-07-01', viaAcesso: false },
        { ...baseItem(), pacienteNome: 'Maria', data: '2026-07-02', viaAcesso: false },
      ];
      expect(detectarModoProducao(itens)).toBe('nao');
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
  });
});
