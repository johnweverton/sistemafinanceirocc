// Validação de dígito verificador de CPF/CNPJ — Achado 2026-09-02 (caso Yana Clara PF): a Cora
// valida o documento de verdade e recusa a emissão ("is not a valid CNPJ or CPF") quando o
// dígito verificador não confere; até aqui o cadastro só checava presença + tamanho (11/14
// dígitos, ver dadosCobrancaSchema), deixando um CPF/CNPJ com dígito digitado errado passar
// despercebido até estourar na Cora — e aí o erro chega como "gateway recusou", genérico, sem
// dizer que o problema é o documento.
// Espera SEMPRE string só de dígitos (sem pontuação) — quem chama já normaliza antes (mesmo
// padrão de `pagadorDocumento` em `DadosCobranca`).

function calcularDigitoVerificador(digitos: number[], pesos: number[]): number {
  const soma = digitos.reduce((acc, d, i) => acc + d * pesos[i]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * true se `cpf` (11 dígitos) tem dígitos verificadores válidos. Rejeita sequências repetidas
 * (ex. "00000000000", "11111111111") — matematicamente "válidas" pelo algoritmo de módulo 11
 * (gotcha conhecido), mas nunca CPFs reais.
 */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const d = cpf.split('').map(Number);
  const dv1 = calcularDigitoVerificador(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== d[9]) return false;
  const dv2 = calcularDigitoVerificador(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === d[10];
}

/**
 * true se `cnpj` (14 dígitos) tem dígitos verificadores válidos. Mesma defesa contra sequência
 * repetida do `cpfValido`.
 */
export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const d = cnpj.split('').map(Number);
  const dv1 = calcularDigitoVerificador(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== d[12]) return false;
  const dv2 = calcularDigitoVerificador(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === d[13];
}

/**
 * Valida `documento` (só dígitos) conforme `tipo` — CPF (11 dígitos) ou CNPJ (14 dígitos).
 * Ponto único de checagem reusado pelo schema de cadastro (Zod, feedback na hora de salvar) e
 * pelo guard de emissão `cobrancaMinimaEmissao` (defesa para documentos já salvos antes desta
 * validação existir).
 */
export function documentoValido(tipo: 'PF' | 'PJ', documento: string): boolean {
  return tipo === 'PF' ? cpfValido(documento) : cnpjValido(documento);
}
