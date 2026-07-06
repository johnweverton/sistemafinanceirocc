import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarMedicoExterno } from '@/server/repositories/medico-repository';
import { criarMedicoExternoSchema } from '@/server/validation/medico-schema';
import { listarClientes } from '@/server/integration/fin-api-client';
import { derivarStatusHapvida } from '@/server/medico-sync';

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  const parsed = criarMedicoExternoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  const { externalId } = parsed.data;
  
  const clientes = await listarClientes();
  const cliente = clientes.find((c) => c.id === externalId);
  if (!cliente) {
    throw new ApiError(404, 'Cliente não encontrado na origem', 'NOT_FOUND');
  }

  const statusHapvida = derivarStatusHapvida(cliente.productionType);
  if (!statusHapvida) {
    throw new ApiError(
      422,
      `Tipo de produção desconhecido: "${cliente.productionType}". Impossível criar médico.`,
      'TIPO_PRODUCAO_DESCONHECIDO',
    );
  }

  const medico = await criarMedicoExterno(
    {
      externalId: cliente.id,
      nome: cliente.nome,
      statusHapvida,
    },
    sessao.userId,
  );

  return Response.json(medico, { status: 201 });
});
