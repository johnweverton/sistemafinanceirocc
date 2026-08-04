// Registro das contas emissoras (Épico 7, arquitetura §2-D2) — METADADOS apenas.
// Credenciais nunca moram aqui: vivem em env vars com o prefixo declarado abaixo
// (resolvidas por getCredenciaisConta em @/lib/env, único leitor de process.env).
// Adicionar uma 3ª conta = nova entrada aqui + env vars correspondentes.
import type { ContaEmissora } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';

export interface ContaEmissoraInfo {
  slug: ContaEmissora;
  /** Nome exibido nas mensagens ao médico (remetente de e-mail etc.) — deriva do shared
   *  (CONTA_EMISSORA_LABEL, fonte única de rótulos desde a Story 7.3). */
  nomeExibicao: string;
  /** Prefixo das env vars de credenciais (ex.: CORA_MC → CORA_MC_CERT_BASE64). */
  envPrefix: string;
}

export const CONTAS_EMISSORAS: Record<ContaEmissora, ContaEmissoraInfo> = {
  mc: {
    slug: 'mc',
    nomeExibicao: CONTA_EMISSORA_LABEL.mc,
    envPrefix: 'CORA_MC',
  },
  cavalcante_viana: {
    slug: 'cavalcante_viana',
    nomeExibicao: CONTA_EMISSORA_LABEL.cavalcante_viana,
    envPrefix: 'CORA_CV',
  },
  carmem_cavalcante: {
    slug: 'carmem_cavalcante',
    nomeExibicao: CONTA_EMISSORA_LABEL.carmem_cavalcante,
    envPrefix: 'CORA_CARMEM',
  },
  cc_solucoes: {
    slug: 'cc_solucoes',
    nomeExibicao: CONTA_EMISSORA_LABEL.cc_solucoes,
    envPrefix: 'CORA_CCSOL',
  },
};
