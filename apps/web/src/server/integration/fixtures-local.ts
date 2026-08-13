// Modo local do Integration Client (Fase 1) — espelha FALLBACK_FILES do motor Python.
// Permite exercitar o pipeline ponta a ponta sem a API da Carmem existir (PRD §11).
// Desde o Épico 5 também serve o contrato REAL (fin-api-client): clientes/produções/itens.
import type {
  ClienteExterno,
  ProducaoExterna,
  LoteExterna,
  ItemProducao,
} from '@cobranca/shared';
import type { MedicoDescoberto } from '@/server/repositories/medico-repository';

// ---------------------------------------------------------------------------
// Fixtures do contrato REAL (Épico 5, story 5.1) — consumidas pelo fin-api-client
// em FIN_API_SOURCE=local.
// ---------------------------------------------------------------------------

/** Médicos simulados da origem. Vazio por padrão. */
let FIXTURE_CLIENTES: ClienteExterno[] = [];

/** Mapa clienteExternoId → produções simuladas. */
const FIXTURE_PRODUCOES: Record<string, ProducaoExterna[]> = {};

/** Mapa producaoExternaId → itens simulados. */
const FIXTURE_ITENS: Record<string, ItemProducao[]> = {};

/**
 * Mapa producaoExternaId (produção MENSAL) → sub-lotes simulados (Cateter/Fístula/Angiografia/
 * Carta de Rede do Angiologista — devolutiva do desenvolvedor, GATE 2026-08-13).
 */
const FIXTURE_LOTES: Record<string, LoteExterna[]> = {};

/** Mapa loteExternoId → itens simulados desse sub-lote. Namespace SEPARADO de FIXTURE_ITENS
 * (ids de lote e de produção não se misturam no contrato real). */
const FIXTURE_ITENS_POR_LOTE: Record<string, ItemProducao[]> = {};

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

export function registrarFixtureLotes(
  producaoExternaId: string,
  lotes: LoteExterna[],
): void {
  FIXTURE_LOTES[producaoExternaId] = lotes;
}

export function registrarFixtureItensPorLote(
  loteExternoId: string,
  itens: ItemProducao[],
): void {
  FIXTURE_ITENS_POR_LOTE[loteExternoId] = itens;
}

export async function listarLotesLocal(
  producaoExternaId: string,
): Promise<LoteExterna[]> {
  return FIXTURE_LOTES[producaoExternaId] ?? [];
}

export async function buscarItensPorLoteLocal(
  loteExternoId: string,
): Promise<ItemProducao[]> {
  return FIXTURE_ITENS_POR_LOTE[loteExternoId] ?? [];
}
