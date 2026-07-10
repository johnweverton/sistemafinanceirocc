// Registro das contas emissoras (Épico 7, arquitetura §2-D2) — METADADOS apenas.
// Credenciais nunca moram aqui: vivem em env vars com o prefixo declarado abaixo
// (resolvidas por getCredenciaisConta em @/lib/env, único leitor de process.env).
// Adicionar uma 3ª conta = nova entrada aqui + env vars correspondentes.
import type { ContaEmissora } from '@cobranca/shared';

export interface ContaEmissoraInfo {
  slug: ContaEmissora;
  /** Nome exibido na UI e nas mensagens ao médico (remetente de e-mail etc.). */
  nomeExibicao: string;
  /** Prefixo das env vars de credenciais (ex.: CORA_MC → CORA_MC_CERT_BASE64). */
  envPrefix: string;
}

export const CONTAS_EMISSORAS: Record<ContaEmissora, ContaEmissoraInfo> = {
  mc: {
    slug: 'mc',
    nomeExibicao: 'MC',
    envPrefix: 'CORA_MC',
  },
  cavalcante_viana: {
    slug: 'cavalcante_viana',
    nomeExibicao: 'Cavalcante Viana',
    envPrefix: 'CORA_CV',
  },
};
