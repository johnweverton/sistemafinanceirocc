// Conta emissora — qual conta Cora da empresa emite o boleto (Épico 7).
// A empresa opera com duas contas: MC e Cavalcante Viana. A conta é um atributo
// CONTRATUAL do médico (D1-A) e fica desnormalizada no boleto emitido (arquitetura §3):
// operações pós-emissão (cancelar/reconsultar) usam SEMPRE a conta do boleto.
// Credenciais NUNCA transitam por aqui — vivem em env vars (D2-A); este módulo é só domínio.

export type ContaEmissora = 'mc' | 'cavalcante_viana';

/** Todas as contas válidas — fonte única para CHECKs de UI/Zod (espelha a CHECK do banco). */
export const CONTAS_EMISSORAS_VALIDAS: readonly ContaEmissora[] = ['mc', 'cavalcante_viana'];

/** Conta usada no backfill e como fallback seguro pré-migration (comportamento original). */
export const CONTA_EMISSORA_DEFAULT: ContaEmissora = 'mc';
