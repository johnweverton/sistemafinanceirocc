import { NextResponse } from 'next/server';
import type { ClienteExterno, ProducaoExterna } from '@cobranca/shared';
import { listarClientes, listarProducoes } from '@/server/integration/fin-api-client';
import { listarMedicos } from '@/server/repositories/medico-repository';
import { requireRole } from '@/server/auth/require-role';

// Achado 2026-08-06: o `revalidate = 300` antigo cacheava a ROTA INTEIRA por 5min, incluindo
// `medicos` — que vem do nosso Postgres e precisa refletir uma configuração feita há segundos
// (o operador configurava o médico e ele só aparecia no checkbox de emissão depois de várias
// atualizações de página, até o cache expirar). O cache de 5min fazia sentido só pra API externa
// "Carmem" (`clientesOrigem`/produções, cara e lenta) — ver mesmo raciocínio documentado em
// medicos-com-boleto/route.ts. Agora: rota sempre dinâmica (médicos sempre frescos); só a busca
// externa é cacheada, num cache simples em memória do processo (não `unstable_cache`: depende do
// contexto de request do Next e não funciona fora dele, inclusive nos testes desta suíte).
export const dynamic = 'force-dynamic';

type ClienteOrigem = { id: string; nome: string; producoes: ProducaoExterna[] };

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { valor: ClienteOrigem[]; expiraEm: number } | null = null;

async function buscarClientesOrigem(): Promise<ClienteOrigem[]> {
  if (cache && cache.expiraEm > Date.now()) return cache.valor;

  const clientes: ClienteExterno[] = await listarClientes();

  // Processa a busca de produções em lotes (chunks) para não estourar limite da API
  const CONCURRENCY_LIMIT = 15;
  const clientesOrigem: ClienteOrigem[] = [];

  for (let i = 0; i < clientes.length; i += CONCURRENCY_LIMIT) {
    const lote = clientes.slice(i, i + CONCURRENCY_LIMIT);
    const resultadosLote = await Promise.all(
      lote.map(async (c) => ({
        id: c.id,
        nome: c.nome,
        producoes: await listarProducoes(c.id),
      }))
    );
    clientesOrigem.push(...resultadosLote);
  }

  cache = { valor: clientesOrigem, expiraEm: Date.now() + CACHE_TTL_MS };
  return clientesOrigem;
}

export async function GET() {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  try {
    // Em paralelo: médicos (sempre frescos, nosso banco) + clientes/origens (cacheados 5min).
    const [medicos, clientesOrigem] = await Promise.all([listarMedicos(), buscarClientesOrigem()]);

    return NextResponse.json({
      medicos,
      clientesOrigem,
    });
  } catch (error) {
    console.error('Erro ao buscar dados de apoio para execucao:', error);
    return NextResponse.json(
      { error: 'Erro interno ao buscar dados de apoio' },
      { status: 500 }
    );
  }
}
