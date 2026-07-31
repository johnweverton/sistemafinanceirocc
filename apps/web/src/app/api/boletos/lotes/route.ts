// POST /api/boletos/lotes — cria o preview de um lote de emissão (Fase A, revisão de
// arquitetura 2026-07-31, decisão 5). Síncrono, só leitura + grava o snapshot congelado —
// nenhuma emissão acontece aqui. Confirmar em POST /api/boletos/lotes/[id]/confirmar.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { montarPreviewLote } from '@/server/orchestrator/emissao-lote-orchestrator';
import { listarItensLote } from '@/server/repositories/lote-emissao-repository';
import { listarResultados } from '@/server/repositories/execucao-repository';

// Raro e planejado (fechamento de competência) — 3/hora é folgado pro uso real e um teto
// significativo contra disparo acidental (diferente do 10/min de emissão individual, que é
// bem mais frequente).
const loteLimiter = createRateLimiter('boletos-lote-criar', { limit: 3, windowMs: 3_600_000 });

const bodySchema = z.object({
  execucaoId: z.string().uuid(),
});

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(loteLimiter, sessao.userId, 'criação de lote de emissão');

  const env = getServerEnv();
  if (env.GATEWAY_EMISSAO_HABILITADA !== 'true') {
    throw new ApiError(403, 'Emissão de boletos desabilitada (GATEWAY_EMISSAO_HABILITADA).', 'EMISSAO_DESABILITADA');
  }
  if (env.EMISSAO_LOTE_HABILITADA !== 'true') {
    throw new ApiError(403, 'Emissão em lote desabilitada (EMISSAO_LOTE_HABILITADA).', 'LOTE_DESABILITADO');
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Payload inválido', 'VALIDATION', { issues: parsed.error.issues });
  }

  const lote = await montarPreviewLote({ execucaoId: parsed.data.execucaoId, criadoPor: sessao.userId });
  const itens = await listarItensLote(lote.id);

  // Nomes só para a UI mostrar QUEM está em cada item (preview e "pulados com motivo" sem nome
  // não ajudam o operador a agir) — join em memória, não vale criar uma view só para isto.
  const resultados = await listarResultados(parsed.data.execucaoId);
  const nomePorResultado = new Map(resultados.map((r) => [r.id, r.nome]));
  const itensComNome = itens.map((item) => ({ ...item, nome: nomePorResultado.get(item.execucaoResultadoId) ?? '—' }));

  const porContaEmissora = new Map<string, { itens: number; valor: number }>();
  for (const item of itens) {
    if (item.status !== 'pendente' || !item.contaEmissora) continue;
    const atual = porContaEmissora.get(item.contaEmissora) ?? { itens: 0, valor: 0 };
    atual.itens += 1;
    atual.valor += item.valorSnapshot;
    porContaEmissora.set(item.contaEmissora, atual);
  }

  return Response.json(
    {
      lote,
      itens: itensComNome,
      porContaEmissora: [...porContaEmissora.entries()].map(([contaEmissora, v]) => ({ contaEmissora, ...v })),
    },
    { status: 201 },
  );
});
