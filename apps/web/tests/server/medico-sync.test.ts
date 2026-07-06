import { describe, it, expect, vi } from 'vitest';
import {
  sincronizar,
  normalizarNome,
  similaridadeNomes,
  derivarStatusHapvida,
  type SyncDeps,
} from '../../src/server/medico-sync';
import type { ClienteExterno, Medico } from '@cobranca/shared';

describe('Medico Sync', () => {
  describe('normalizarNome', () => {
    it('remove acentos, títulos e pontuação', () => {
      expect(normalizarNome('Dr. João Silva')).toBe('joao silva');
      expect(normalizarNome('Dra. Maria  Fernanda!')).toBe('maria fernanda');
      expect(normalizarNome('Doutor Érico')).toBe('erico');
      expect(normalizarNome('Dr José')).toBe('jose');
      expect(normalizarNome('Clinica João & Maria')).toBe('clinica joao maria');
    });
  });

  describe('derivarStatusHapvida', () => {
    it('reconhece tipos conhecidos', () => {
      expect(derivarStatusHapvida('Produção Credenciada')).toBe('credenciado');
      expect(derivarStatusHapvida('Produção VH')).toBe('nao_credenciado');
      expect(derivarStatusHapvida('producao  credenciada ')).toBe('credenciado');
    });
    it('retorna null para desconhecidos', () => {
      expect(derivarStatusHapvida('Produção Nova')).toBeNull();
      expect(derivarStatusHapvida('')).toBeNull();
    });
  });

  describe('similaridadeNomes', () => {
    it('calcula corretamente a sobreposição de tokens', () => {
      expect(similaridadeNomes('João Silva', 'Joao Silva')).toBe(1); // exato após normalizar
      expect(similaridadeNomes('João da Silva', 'João Silva')).toBeCloseTo(0.8); // 2/(3+2) = 0.8
      expect(similaridadeNomes('Maria', 'João')).toBe(0);
    });
  });

  describe('sincronizar()', () => {
    const clientesOrigem: ClienteExterno[] = [
      { id: 'ext-1', nome: 'João Silva', productionType: 'Produção Credenciada' }, // Vinculado, sem mudança
      { id: 'ext-2', nome: 'Maria Nova', productionType: 'Produção VH' }, // Vinculado, nome mudou
      { id: 'ext-3', nome: 'Dra. Ana', productionType: 'Produção Credenciada' }, // Não vinculado, com par
      { id: 'ext-4', nome: 'Pedro', productionType: 'Produção Credenciada' }, // Não vinculado, sem par
      { id: 'ext-5', nome: 'Clinica X', productionType: 'Desconhecido' }, // Não sincronizável
      { id: 'ext-6', nome: 'Zebra', productionType: 'Desconhecido' }, // Vinculado, mas origem mudou p/ desconhecido
    ];

    const medicosCadastrados = [
      { id: 'med-1', externalId: 'ext-1', nome: 'João Silva', statusHapvida: 'credenciado' },
      { id: 'med-2', externalId: 'ext-2', nome: 'Maria Antiga', statusHapvida: 'nao_credenciado' },
      { id: 'med-3', externalId: null, nome: 'Ana', statusHapvida: 'credenciado' },
      { id: 'med-6', externalId: 'ext-6', nome: 'Zebra', statusHapvida: 'credenciado' },
    ] as Medico[];

    it('classifica e gera relatório corretamente', async () => {
      const atualizarMedicoMock = vi.fn().mockResolvedValue({});
      const deps: SyncDeps = {
        listarClientes: async () => clientesOrigem,
        listarMedicos: async () => medicosCadastrados,
        atualizarMedico: atualizarMedicoMock,
      };

      const relatorio = await sincronizar('admin-id', deps);

      expect(relatorio.totalOrigem).toBe(6);
      expect(relatorio.jaVinculados).toBe(3); // ext-1, ext-2, ext-6
      expect(relatorio.atualizados).toBe(1); // ext-2 mudou de nome
      
      // Verifica atualização do vinculado que mudou de nome
      expect(atualizarMedicoMock).toHaveBeenCalledTimes(1);
      expect(atualizarMedicoMock).toHaveBeenCalledWith(
        'med-2',
        { nome: 'Maria Nova' },
        'admin-id',
        expect.any(String),
      );

      // Desconhecidos vão para não sincronizáveis
      expect(relatorio.naoSincronizaveis).toHaveLength(2);
      expect(relatorio.naoSincronizaveis[0]?.cliente.id).toBe('ext-5'); // O novo não pode ser criado
      expect(relatorio.naoSincronizaveis[1]?.cliente.id).toBe('ext-6'); // O vinculado mantém status e avisa

      // Pendentes com sugestão (match de Ana)
      expect(relatorio.comSugestao).toHaveLength(1);
      expect(relatorio.comSugestao[0]?.cliente.id).toBe('ext-3');
      expect(relatorio.comSugestao[0]?.candidatas[0]?.medicoId).toBe('med-3');

      // Sem par (Pedro)
      expect(relatorio.semPar).toHaveLength(1);
      expect(relatorio.semPar[0]?.id).toBe('ext-4');
    });
  });
});
