// Modo local do Integration Client (Fase 1) — espelha FALLBACK_FILES do motor Python.
// Permite exercitar o pipeline ponta a ponta sem a API da Carmem existir (PRD §11).
// Em Fase 1 isto é um stub vazio + ponto de extensão: registre fixtures por CPF aqui
// ou aponte para um diretório de fixtures quando quiser testar uma execução completa.
import type { Procedimento } from '@cobranca/shared';

/** Mapa CPF → procedimentos de teste. Vazio por padrão (sem produção = 'sem_dados'). */
const FIXTURES: Record<string, Procedimento[]> = {};

/** Registra fixtures de um CPF em runtime (usado por testes de integração). */
export function registrarFixtureLocal(cpf: string, procedimentos: Procedimento[]): void {
  FIXTURES[cpf] = procedimentos;
}

export async function buscarProcedimentosLocal(
  cpf: string,
  _competencia: string,
): Promise<Procedimento[]> {
  return FIXTURES[cpf] ?? [];
}
