import { getServerEnv } from '@/lib/env';

export class ZappyGateway {
  private apiUrl: string;
  private apiToken: string;

  constructor() {
    const env = getServerEnv();
    if (!env.ZAPPY_API_URL || !env.ZAPPY_API_TOKEN) {
      throw new Error('Variáveis ZAPPY_API_URL ou ZAPPY_API_TOKEN não configuradas.');
    }
    this.apiUrl = env.ZAPPY_API_URL.replace(/\/$/, '');
    this.apiToken = env.ZAPPY_API_TOKEN;
  }

  private async fetchApi(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro na API do Zappy (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Envia uma mensagem de texto simples.
   * @param to Número de destino (ex: 5511999999999) ou ID do grupo
   * @param text Texto da mensagem
   */
  async enviarTexto(to: string, text: string) {
    return this.fetchApi(`/api/send/${encodeURIComponent(to)}`, 'POST', {
      body: text,
    });
  }

  /**
   * Envia um documento utilizando uma URL pública (ex: URL do boleto da Cora).
   * @param to Número de destino (ex: 5511999999999) ou ID do grupo
   * @param url URL pública do documento PDF
   */
  async enviarDocumentoPorUrl(to: string, url: string) {
    return this.fetchApi(`/api/send/document/${encodeURIComponent(to)}`, 'POST', {
      url,
    });
  }
}
