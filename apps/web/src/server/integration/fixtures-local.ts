// Modo local do Integration Client (Fase 1) — espelha FALLBACK_FILES do motor Python.
// Permite exercitar o pipeline ponta a ponta sem a API da Carmem existir (PRD §11).
import type { Procedimento } from '@cobranca/shared';
import type { MedicoDescoberto } from '@/server/repositories/medico-repository';

/** Mapa CPF → procedimentos de teste. Vazio por padrão (sem produção = 'sem_dados'). */
const FIXTURES: Record<string, Procedimento[]> = {};

/** Lista de médicos simulados para descoberta (auto-provisioning). Vazia por padrão. */
let FIXTURE_CPFS: MedicoDescoberto[] = [];

export function registrarFixtureLocal(cpf: string, procedimentos: Procedimento[]): void {
  FIXTURES[cpf] = procedimentos;
}

/** Registra médicos simulados para o modo local de auto-descoberta. */
export function registrarFixtureCpfs(medicos: MedicoDescoberto[]): void {
  FIXTURE_CPFS = medicos;
}

export async function buscarProcedimentosLocal(
  cpf: string,
  _competencia: string,
): Promise<Procedimento[]> {
  return FIXTURES[cpf] ?? [];
}

export async function listarCpfsLocal(
  _competencia: string,
): Promise<MedicoDescoberto[]> {
  return FIXTURE_CPFS;
}
