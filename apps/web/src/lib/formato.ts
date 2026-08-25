// Formatação de apresentação compartilhada (Épico 12, story 12.2 — gaps G-27/G-28).
// Antes desta story cada tela carregava a sua própria cópia de `brl()`/`normalizarBusca()`
// (17 + 6 cópias em `apps/web/src`), e os pontos que esqueciam de copiar caíam no
// `R$ ${v.toFixed(2)}` cru — que renderiza "R$ 1480.56" em vez de "R$ 1.480,56".
//
// ESCOPO: só formatação/normalização de string. Nada de regra de negócio mora aqui.
// Aritmética de competência (AAAA-MM) fica em `lib/competencia.ts`.

/**
 * Valor monetário em pt-BR: `1480.56` → `"R$ 1.480,56"`.
 *
 * Aceita `null`/`undefined` porque metade dos consumidores lê valores nuláveis do banco
 * (`totalValor`, `saldo`, `valorPago`) e todos já tratavam a ausência como zero — o
 * comportamento das cópias locais é preservado 1:1, sem `?? 0` espalhado no JSX.
 *
 * Atenção ao testar: `toLocaleString` insere um espaço NÃO quebrável (U+00A0) entre "R$" e o
 * número. Comparar com `'R$ 1.480,56'` digitado com espaço comum só funciona através do
 * normalizador do Testing Library (`getByText`), que colapsa `\s` — em comparação crua, use
 * `t.replace(/\s/g, ' ')`.
 */
export function brl(valor: number | null | undefined): string {
  return (valor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Texto pronto para comparação de busca: sem acento e em caixa baixa.
 * `"Dr. José Ângelo"` → `"dr. jose angelo"`.
 *
 * NFD separa a letra do diacrítico e o `replace` remove o bloco Combining Diacritical Marks
 * (U+0300–U+036F) — é o que permite "jose" achar "José". Não faz `trim()` de propósito: quem
 * busca compara com `includes()`, e o espaço que o operador digitou no meio do termo é
 * significativo.
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
