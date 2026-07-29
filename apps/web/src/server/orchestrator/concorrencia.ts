// Limitador de concorrência simples (sem dependência externa) — projeto evita libs pequenas
// para utilitários deste porte (mesmo espírito de rate-limit.ts/medico-sync.ts).

/**
 * Executa `tarefa` para cada item de `itens`, com no máximo `limite` execuções simultâneas.
 * Cada chamada de `tarefa` deve resolver sempre (nunca rejeitar) se o chamador precisar
 * isolar falhas por item — este helper não faz nenhum tratamento de erro por conta própria.
 */
export async function executarComLimite<T>(
  itens: T[],
  limite: number,
  tarefa: (item: T, indice: number) => Promise<void>,
): Promise<void> {
  if (itens.length === 0) return;
  const concorrencia = Math.max(1, Math.min(limite, itens.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < itens.length) {
      const indice = cursor++;
      await tarefa(itens[indice]!, indice);
    }
  }

  await Promise.all(Array.from({ length: concorrencia }, () => worker()));
}
