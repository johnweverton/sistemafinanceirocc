import { NextResponse } from 'next/server';
import { listarClientes, listarProducoes } from '@/server/integration/fin-api-client';
import { listarMedicos } from '@/server/repositories/medico-repository';

export const revalidate = 300; // Cache por 5 minutos (evita requisições excessivas à API externa)

export async function GET() {
  try {
    // 1. Busca todos os médicos vinculados no nosso sistema
    const medicos = await listarMedicos();

    // 2. Busca todos os clientes/origens
    const clientes = await listarClientes();
    
    // Processa a busca de produções em lotes (chunks) para não estourar limite da API
    const CONCURRENCY_LIMIT = 15;
    const clientesOrigem = [];
    
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
