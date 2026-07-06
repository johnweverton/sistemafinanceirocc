import { NextResponse } from 'next/server';
import { listarClientes } from '@/server/integration/fin-api-client';
import { listarMedicos } from '@/server/repositories/medico-repository';

export async function GET() {
  try {
    // 1. Busca todos os médicos vinculados no nosso sistema
    const medicos = await listarMedicos();

    // 2. Busca todos os clientes/origens e suas produções do fin-api-client
    const clientesOrigem = await listarClientes();

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
