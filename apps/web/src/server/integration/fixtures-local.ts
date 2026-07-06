// Modo local do Integration Client (Fase 1) — espelha FALLBACK_FILES do motor Python.
// Permite exercitar o pipeline ponta a ponta sem a API da Carmem existir (PRD §11).
// Desde o Épico 5 também serve o contrato REAL (fin-api-client): clientes/produções/itens.
import type {
  Procedimento,
  ClienteExterno,
  ProducaoExterna,
  ItemProducao,
} from '@cobranca/shared';
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

// ---------------------------------------------------------------------------
// Fixtures do contrato REAL (Épico 5, story 5.1) — consumidas pelo fin-api-client
// em FIN_API_SOURCE=local. As fixtures antigas acima permanecem até o cutover (5.5).
// ---------------------------------------------------------------------------

/** Médicos simulados da origem. Vazio por padrão. */
let FIXTURE_CLIENTES: ClienteExterno[] = [];

/** Mapa clienteExternoId → produções simuladas. */
const FIXTURE_PRODUCOES: Record<string, ProducaoExterna[]> = {};

/** Mapa producaoExternaId → itens simulados. */
const FIXTURE_ITENS: Record<string, ItemProducao[]> = {};

export function registrarFixtureClientes(clientes: ClienteExterno[]): void {
  FIXTURE_CLIENTES = clientes;
}

export function registrarFixtureProducoes(
  clienteExternoId: string,
  producoes: ProducaoExterna[],
): void {
  FIXTURE_PRODUCOES[clienteExternoId] = producoes;
}

export function registrarFixtureItens(
  producaoExternaId: string,
  itens: ItemProducao[],
): void {
  FIXTURE_ITENS[producaoExternaId] = itens;
}

export async function listarClientesLocal(): Promise<ClienteExterno[]> {
  return FIXTURE_CLIENTES;
}

export async function listarProducoesLocal(
  clienteExternoId: string,
): Promise<ProducaoExterna[]> {
  return FIXTURE_PRODUCOES[clienteExternoId] ?? [];
}

export async function buscarItensLocal(
  producaoExternaId: string,
): Promise<ItemProducao[]> {
  return FIXTURE_ITENS[producaoExternaId] ?? [];
}
