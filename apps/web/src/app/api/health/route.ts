// Endpoint público de saúde (excluído do middleware de auth).
// Achado M-3: resposta minimalista — não vazar timestamp/timezone do servidor.
export function GET() {
  return Response.json({ ok: true });
}
