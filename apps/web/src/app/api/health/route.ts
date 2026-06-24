// Endpoint público de saúde (excluído do middleware de auth).
export function GET() {
  return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
}
