// Conta emissora — qual conta Cora da empresa emite o boleto (Épico 7, ampliado em 2026-08-03
// para 4 contas: médicos/empresas continuam em MC/Cavalcante Viana, e o serviço de contabilidade
// passa a emitir por Carmem Cavalcante/CC Soluções — mas as 4 ficam disponíveis em todo o sistema.
// A conta é um atributo CONTRATUAL do médico/empresa/cliente (D1-A) e fica desnormalizada no
// boleto emitido (arquitetura §3): operações pós-emissão (cancelar/reconsultar) usam SEMPRE a
// conta do boleto. Credenciais NUNCA transitam por aqui — vivem em env vars (D2-A); este módulo
// é só domínio.

export type ContaEmissora = 'mc' | 'cavalcante_viana' | 'carmem_cavalcante' | 'cc_solucoes';

/** Todas as contas válidas — fonte única para CHECKs de UI/Zod (espelha a CHECK do banco).
 *  Tupla `as const` para permitir uso direto em z.enum (QA-711-2). */
export const CONTAS_EMISSORAS_VALIDAS = [
  'mc',
  'cavalcante_viana',
  'carmem_cavalcante',
  'cc_solucoes',
] as const satisfies readonly ContaEmissora[];

/** Conta usada no backfill e como fallback seguro pré-migration (comportamento original). */
export const CONTA_EMISSORA_DEFAULT: ContaEmissora = 'mc';

/**
 * Nome exibido de cada conta — fonte ÚNICA dos rótulos (Story 7.3): UI, e-mail e registro
 * server-side derivam daqui. Nunca escrever o nome da empresa como string solta.
 */
export const CONTA_EMISSORA_LABEL: Record<ContaEmissora, string> = {
  mc: 'MC',
  cavalcante_viana: 'Cavalcante Viana',
  carmem_cavalcante: 'Carmem Cavalcante',
  cc_solucoes: 'CC Soluções',
};
