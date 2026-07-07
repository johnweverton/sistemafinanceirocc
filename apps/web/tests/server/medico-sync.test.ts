import { describe, it, expect, vi } from 'vitest';
import {
  sincronizar,
  normalizarNome,
  similaridadeNomes,
  derivarStatusHapvida,
  type SyncDeps,
} from '../../src/server/medico-sync';
import { ApiError } from '../../src/lib/api-error';
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
      { id: 'ext-1', nome: 'João Silva', cpf: null, productionType: 'Produção Credenciada' }, // Vinculado, sem mudança
      { id: 'ext-2', nome: 'Maria Nova', cpf: null, productionType: 'Produção VH' }, // Vinculado, nome mudou
      { id: 'ext-3', nome: 'Dra. Ana', cpf: null, productionType: 'Produção Credenciada' }, // Não vinculado, com par
      { id: 'ext-4', nome: 'Pedro', cpf: null, productionType: 'Produção Credenciada' }, // Não vinculado, sem par
      { id: 'ext-5', nome: 'Clinica X', cpf: null, productionType: 'Desconhecido' }, // Não sincronizável
      { id: 'ext-6', nome: 'Zebra', cpf: null, productionType: 'Desconhecido' }, // Vinculado, mas origem mudou p/ desconhecido
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

  describe('sincronizar() — matching por CPF', () => {
    it('CPF idêntico vira candidata mesmo com nome muito diferente, marcada viaCpf', async () => {
      const clientes: ClienteExterno[] = [
        { id: 'ext-10', nome: 'Zé da Silva', cpf: '11122233344', productionType: 'Produção Credenciada' },
      ];
      const medicos = [
        {
          id: 'med-10',
          externalId: null,
          nome: 'Doutor Completamente Diferente',
          cpf: '11122233344',
          statusHapvida: 'credenciado',
        },
      ] as Medico[];

      const relatorio = await sincronizar('admin-id', {
        listarClientes: async () => clientes,
        listarMedicos: async () => medicos,
        atualizarMedico: vi.fn(),
      });

      expect(relatorio.semPar).toHaveLength(0);
      expect(relatorio.comSugestao).toHaveLength(1);
      expect(relatorio.comSugestao[0]?.candidatas).toEqual([
        { medicoId: 'med-10', nome: 'Doutor Completamente Diferente', score: 1, viaCpf: true },
      ]);
    });

    it('candidata por CPF aparece antes de candidatas apenas por nome', async () => {
      const clientes: ClienteExterno[] = [
        { id: 'ext-11', nome: 'Carlos Souza', cpf: '99988877766', productionType: 'Produção Credenciada' },
      ];
      const medicos = [
        { id: 'med-11a', externalId: null, nome: 'Carlos Souza Junior', cpf: null, statusHapvida: 'credenciado' },
        { id: 'med-11b', externalId: null, nome: 'Outro Nome Qualquer', cpf: '99988877766', statusHapvida: 'credenciado' },
      ] as Medico[];

      const relatorio = await sincronizar('admin-id', {
        listarClientes: async () => clientes,
        listarMedicos: async () => medicos,
        atualizarMedico: vi.fn(),
      });

      const candidatas = relatorio.comSugestao[0]?.candidatas ?? [];
      expect(candidatas[0]).toMatchObject({ medicoId: 'med-11b', viaCpf: true });
      expect(candidatas[1]).toMatchObject({ medicoId: 'med-11a', viaCpf: false });
    });

    it('CPF e nome apontando pro mesmo médico geram uma única candidata (viaCpf vence)', async () => {
      const clientes: ClienteExterno[] = [
        { id: 'ext-12', nome: 'Fernanda Lima', cpf: '55566677788', productionType: 'Produção Credenciada' },
      ];
      const medicos = [
        { id: 'med-12', externalId: null, nome: 'Fernanda Lima', cpf: '55566677788', statusHapvida: 'credenciado' },
      ] as Medico[];

      const relatorio = await sincronizar('admin-id', {
        listarClientes: async () => clientes,
        listarMedicos: async () => medicos,
        atualizarMedico: vi.fn(),
      });

      expect(relatorio.comSugestao[0]?.candidatas).toEqual([
        { medicoId: 'med-12', nome: 'Fernanda Lima', score: 1, viaCpf: true },
      ]);
    });
  });

  describe('sincronizar() — backfill de CPF em médicos já vinculados', () => {
    it('preenche cpf de um vinculado que ficou sem CPF (criado antes da origem entregar)', async () => {
      const clientes: ClienteExterno[] = [
        { id: 'ext-20', nome: 'Roberto Alves', cpf: '12312312300', productionType: 'Produção Credenciada' },
      ];
      const medicos = [
        { id: 'med-20', externalId: 'ext-20', nome: 'Roberto Alves', cpf: null, statusHapvida: 'credenciado' },
      ] as Medico[];
      const atualizarMedicoMock = vi.fn().mockResolvedValue({});

      const relatorio = await sincronizar('admin-id', {
        listarClientes: async () => clientes,
        listarMedicos: async () => medicos,
        atualizarMedico: atualizarMedicoMock,
      });

      expect(atualizarMedicoMock).toHaveBeenCalledWith(
        'med-20',
        { cpf: '12312312300' },
        'admin-id',
        expect.any(String),
      );
      expect(relatorio.atualizados).toBe(1);
    });

    it('não sobrescreve cpf já cadastrado no médico vinculado', async () => {
      const clientes: ClienteExterno[] = [
        { id: 'ext-21', nome: 'Marcos Dias', cpf: '99999999900', productionType: 'Produção Credenciada' },
      ];
      const medicos = [
        { id: 'med-21', externalId: 'ext-21', nome: 'Marcos Dias', cpf: '11111111100', statusHapvida: 'credenciado' },
      ] as Medico[];
      const atualizarMedicoMock = vi.fn().mockResolvedValue({});

      const relatorio = await sincronizar('admin-id', {
        listarClientes: async () => clientes,
        listarMedicos: async () => medicos,
        atualizarMedico: atualizarMedicoMock,
      });

      expect(atualizarMedicoMock).not.toHaveBeenCalled();
      expect(relatorio.atualizados).toBe(0);
    });

    it('conflito ao atualizar (ex.: cpf duplicado) vira naoSincronizavel e não aborta o restante do lote', async () => {
      const clientes: ClienteExterno[] = [
        { id: 'ext-22', nome: 'Conflito CPF', cpf: '55555555500', productionType: 'Produção Credenciada' },
        { id: 'ext-23', nome: 'Segue Normal', cpf: '66666666600', productionType: 'Produção Credenciada' },
      ];
      const medicos = [
        { id: 'med-22', externalId: 'ext-22', nome: 'Conflito CPF', cpf: null, statusHapvida: 'credenciado' },
        { id: 'med-23', externalId: 'ext-23', nome: 'Segue Normal', cpf: null, statusHapvida: 'credenciado' },
      ] as Medico[];

      const atualizarMedicoMock = vi.fn(async (id: string) => {
        if (id === 'med-22') {
          throw new ApiError(500, 'Falha ao atualizar médico', 'DB_ERROR');
        }
        return {} as Medico;
      });

      const relatorio = await sincronizar('admin-id', {
        listarClientes: async () => clientes,
        listarMedicos: async () => medicos,
        atualizarMedico: atualizarMedicoMock,
      });

      expect(atualizarMedicoMock).toHaveBeenCalledTimes(2);
      expect(relatorio.atualizados).toBe(1); // só med-23 completou
      expect(relatorio.naoSincronizaveis).toHaveLength(1);
      expect(relatorio.naoSincronizaveis[0]?.cliente.id).toBe('ext-22');
      expect(relatorio.naoSincronizaveis[0]?.motivo).toBe('Falha ao atualizar médico');
    });
  });
});
