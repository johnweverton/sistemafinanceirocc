// Sincronização de médicos com a origem (Épico 5, arquitetura §3.6).
// sincronizar() é LEITURA + relatório: nenhum vínculo/criação acontece aqui — só a
// atualização de médicos JÁ vinculados (nome/statusHapvida, com histórico). Vincular e
// criar exigem confirmação humana via rotas próprias (decisão 9: matching assistido).
import type { ClienteExterno, Medico } from '@cobranca/shared';
import { listarClientes } from '@/server/integration/fin-api-client';
import {
  listarMedicos,
  atualizarMedico,
  type NovoMedico,
} from '@/server/repositories/medico-repository';

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário direto)
// ---------------------------------------------------------------------------

/**
 * Deriva statusHapvida de production_type (decisão 10 do épico, confirmada pelo dono):
 * "Produção Credenciada" → credenciado · "Produção VH" → nao_credenciado.
 * Valor desconhecido → null (cliente vira `naoSincronizavel` — NUNCA criar com 'nenhum',
 * o CHECK combinacao_classe_valida proíbe 'nenhum' sem outros hospitais).
 */
export function derivarStatusHapvida(
  productionType: string,
): 'credenciado' | 'nao_credenciado' | null {
  const t = normalizarNome(productionType);
  if (t === 'producao credenciada') return 'credenciado';
  if (t === 'producao vh') return 'nao_credenciado';
  return null;
}

/** Normaliza para comparação: minúsculas, sem acentos, sem títulos (dr/dra), só [a-z0-9 ]. */
export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos (combining marks pós-NFD)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // pontuação → espaço ("Dr." → "dr ")
    .replace(/\b(dr|dra|doutor|doutora)\b/g, ' ') // remove títulos
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Similaridade por sobreposição de tokens (coeficiente de Dice): 2·|A∩B| / (|A|+|B|).
 * Sem dependência nova (arquitetura §5.2). 1.0 = tokens idênticos; 0 = nada em comum.
 */
export function similaridadeNomes(a: string, b: string): number {
  const ta = new Set(normalizarNome(a).split(' ').filter(Boolean));
  const tb = new Set(normalizarNome(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let comuns = 0;
  for (const t of ta) if (tb.has(t)) comuns += 1;
  return (2 * comuns) / (ta.size + tb.size);
}

/** Score mínimo para sugerir um par; abaixo disso o cliente vai para "sem par". */
export const SCORE_MINIMO_SUGESTAO = 0.5;
/** Máximo de candidatas por cliente (a UI ordena por score). */
export const MAX_CANDIDATAS = 5;

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface CandidataVinculo {
  medicoId: string;
  nome: string;
  score: number;
}

export interface PendenciaSugestao {
  cliente: ClienteExterno;
  candidatas: CandidataVinculo[]; // ordenadas por score desc — usuário confirma/rejeita
}

export interface NaoSincronizavel {
  cliente: ClienteExterno;
  motivo: string;
}

export interface RelatorioSincronizacao {
  totalOrigem: number;
  jaVinculados: number;
  atualizados: number; // subset dos jaVinculados que tiveram nome/status atualizado
  comSugestao: PendenciaSugestao[];
  semPar: ClienteExterno[];
  naoSincronizaveis: NaoSincronizavel[];
}

// Dependências injetáveis (padrão do orchestrator) — teste sem Supabase/rede.
export interface SyncDeps {
  listarClientes: () => Promise<ClienteExterno[]>;
  listarMedicos: () => Promise<Medico[]>;
  atualizarMedico: (
    id: string,
    dados: Partial<NovoMedico>,
    autorId: string,
    motivo: string,
  ) => Promise<Medico>;
}

function depsPadrao(): SyncDeps {
  return { listarClientes, listarMedicos, atualizarMedico };
}

/**
 * Classifica cada cliente da origem (arquitetura §3.6):
 *   - vinculado (external_id)  → atualiza nome/statusHapvida se mudou (com histórico)
 *   - production_type desconhecido → naoSincronizavel (vinculado mantém status atual)
 *   - com candidata(s) por nome    → comSugestao (usuário confirma via /vincular)
 *   - sem candidata                → semPar (usuário cria via /criar-externo)
 */
export async function sincronizar(
  autorId: string,
  deps: SyncDeps = depsPadrao(),
): Promise<RelatorioSincronizacao> {
  const [clientes, medicos] = await Promise.all([deps.listarClientes(), deps.listarMedicos()]);

  const porExternalId = new Map<string, Medico>();
  for (const m of medicos) if (m.externalId) porExternalId.set(m.externalId, m);
  const semVinculo = medicos.filter((m) => !m.externalId);

  const relatorio: RelatorioSincronizacao = {
    totalOrigem: clientes.length,
    jaVinculados: 0,
    atualizados: 0,
    comSugestao: [],
    semPar: [],
    naoSincronizaveis: [],
  };

  for (const cliente of clientes) {
    const status = derivarStatusHapvida(cliente.productionType);
    const vinculado = porExternalId.get(cliente.id);

    if (vinculado) {
      relatorio.jaVinculados += 1;
      if (!status) {
        relatorio.naoSincronizaveis.push({
          cliente,
          motivo: `production_type desconhecido ("${cliente.productionType}") — statusHapvida atual mantido`,
        });
        continue;
      }
      const mudancas: Partial<NovoMedico> = {};
      if (cliente.nome && cliente.nome !== vinculado.nome) mudancas.nome = cliente.nome;
      if (status !== vinculado.statusHapvida) mudancas.statusHapvida = status;
      if (Object.keys(mudancas).length > 0) {
        await deps.atualizarMedico(
          vinculado.id,
          mudancas,
          autorId,
          'Sincronização com o sistema web',
        );
        relatorio.atualizados += 1;
      }
      continue;
    }

    if (!status) {
      relatorio.naoSincronizaveis.push({
        cliente,
        motivo: `production_type desconhecido ("${cliente.productionType}") — não é possível criar/vincular`,
      });
      continue;
    }

    const candidatas: CandidataVinculo[] = semVinculo
      .map((m) => ({ medicoId: m.id, nome: m.nome, score: similaridadeNomes(m.nome, cliente.nome) }))
      .filter((c) => c.score >= SCORE_MINIMO_SUGESTAO)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATAS);

    if (candidatas.length > 0) {
      relatorio.comSugestao.push({ cliente, candidatas });
    } else {
      relatorio.semPar.push(cliente);
    }
  }

  return relatorio;
}
