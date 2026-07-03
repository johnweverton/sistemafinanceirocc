// Helper compartilhado da data de vencimento — usado tanto no payload do gateway (payment_terms)
// quanto na persistência de `boletos.vencimento`, garantindo a MESMA data (coerência, Story 4.2).

/** Data de vencimento = hoje + diasVencimento, no formato AAAA-MM-DD. */
export function calcularVencimento(diasVencimento: number): string {
  const d = new Date();
  d.setDate(d.getDate() + diasVencimento);
  return d.toISOString().slice(0, 10);
}
