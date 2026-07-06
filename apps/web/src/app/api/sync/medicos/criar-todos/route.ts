import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarMedicoExterno } from '@/server/repositories/medico-repository';
import { criarMedicosExternosSchema } from '@/server/validation/medico-schema';
import { listarClientes } from '@/server/integration/fin-api-client';
import { derivarStatusHapvida } from '@/server/medico-sync';

export interface CriarTodosResultado {
  criados: number;
  ignorados: { externalId: string; nome: string | null; motivo: string }[];
}

// Criação em lote: uma única consulta à origem alimenta todos os inserts —
// evita 1 chamada à API externa por médico (o modal pode enviar 170+ de uma vez).
export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  const parsed = criarMedicosExternosSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  const clientes = await listarClientes();
  const porId = new Map(clientes.map((c) => [c.id, c]));

  const resultado: CriarTodosResultado = { criados: 0, ignorados: [] };

  for (const externalId of parsed.data.externalIds) {
    const cliente = porId.get(externalId);
    if (!cliente) {
      resultado.ignorados.push({ externalId, nome: null, motivo: 'Cliente não encontrado na origem' });
      continue;
    }

    const statusHapvida = derivarStatusHapvida(cliente.productionType);
    if (!statusHapvida) {
      resultado.ignorados.push({
        externalId,
        nome: cliente.nome,
        motivo: `Tipo de produção desconhecido: "${cliente.productionType}"`,
      });
      continue;
    }

    try {
      await criarMedicoExterno(
        { externalId: cliente.id, nome: cliente.nome, statusHapvida },
        sessao.userId,
      );
      resultado.criados += 1;
    } catch (error) {
      resultado.ignorados.push({
        externalId,
        nome: cliente.nome,
        motivo: error instanceof ApiError ? error.message : 'Erro ao criar médico',
      });
    }
  }

  return Response.json(resultado);
});
