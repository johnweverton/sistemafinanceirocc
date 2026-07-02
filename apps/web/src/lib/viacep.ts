// Consulta de endereço por CEP via ViaCEP (público, client-side, sem segredo).
// Requer que https://viacep.com.br esteja no connect-src da CSP (next.config.mjs).

export interface EnderecoViaCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

interface ViaCepResposta {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/**
 * Busca o endereço de um CEP (8 dígitos). Retorna null se o CEP for inválido, não existir
 * ou a rede falhar — o chamador deve degradar com graça (permitir digitação manual).
 */
export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoViaCep | null> {
  const limpo = cep.replace(/\D/g, '');
  if (limpo.length !== 8) return null;
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as ViaCepResposta;
    if (data.erro) return null;
    return {
      logradouro: data.logradouro ?? '',
      bairro: data.bairro ?? '',
      cidade: data.localidade ?? '',
      uf: data.uf ?? '',
    };
  } catch {
    return null; // rede indisponível — degrada para preenchimento manual
  }
}
