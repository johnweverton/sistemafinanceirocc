// Zappy (ZapContábil) Gateway — envio de WhatsApp via API Whaticket.
//
// CONTRATO REAL (verificado em 2026-07-09, mesma lição do Épico 5: contrato presumido ≠ real):
//   - O host do painel (carmemcontabilidade.zapcontabil.chat) é o FRONTEND — devolve HTML 200
//     para qualquer path, inclusive /api/* (por isso o parse de JSON falhava com "<!DOCTYPE").
//   - A API fica em host separado com prefixo `api-`: https://api-carmemcontabilidade.zapcontabil.chat
//     (GET / → {"status":true,"version":"2026.26..."}). ZAPPY_API_URL deve apontar para ELE.
//   - Envio: POST /api/messages/send com Bearer token (padrão Whaticket).
//       JSON  { number, body }                → mensagem de texto.
//       multipart { number, body, medias }    → documento/mídia (arquivo no corpo).
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

  /**
   * Normaliza número BR para o formato aceito pelo Whaticket (dígitos, com DDI).
   * "(85) 99999-9999" → "5585999999999". Se já vier com 55, mantém.
   */
  private normalizarNumero(to: string): string {
    const digitos = to.replace(/\D/g, '');
    if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
    return digitos;
  }

  /**
   * Lê a resposta com tolerância a corpo não-JSON: se vier HTML (URL apontando para o
   * frontend, proxy, página de erro), o erro carrega o início do corpo para diagnóstico
   * em boletos_disparos.mensagem_erro — nunca mais um "Unexpected token '<'" mudo.
   */
  private async lerResposta(response: Response): Promise<unknown> {
    const texto = await response.text();
    if (!response.ok) {
      throw new Error(`Erro na API do Zappy (${response.status}): ${texto.slice(0, 300)}`);
    }
    try {
      return texto ? JSON.parse(texto) : null;
    } catch {
      throw new Error(
        `API do Zappy respondeu ${response.status} mas o corpo não é JSON ` +
          `(ZAPPY_API_URL aponta para a API ou para o painel?): ${texto.slice(0, 200)}`,
      );
    }
  }

  /**
   * Envia uma mensagem de texto simples.
   * @param to Número de destino (ex: 5585999999999) ou ID do grupo
   * @param text Texto da mensagem
   */
  async enviarTexto(to: string, text: string) {
    const response = await fetch(`${this.apiUrl}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({ number: this.normalizarNumero(to), body: text }),
    });
    return this.lerResposta(response);
  }

  /**
   * Envia um documento a partir de uma URL pública (ex: PDF do boleto da Cora).
   * O arquivo é baixado aqui e enviado como multipart `medias` (contrato Whaticket) —
   * a API não busca URLs remotas por conta própria.
   * @param to Número de destino (ex: 5585999999999) ou ID do grupo
   * @param url URL pública do documento PDF
   * @param legenda Texto que acompanha o documento (caption)
   */
  async enviarDocumentoPorUrl(to: string, url: string, legenda = 'Segue o boleto para pagamento.') {
    const download = await fetch(url);
    if (!download.ok) {
      throw new Error(`Falha ao baixar o documento para envio (${download.status}): ${url}`);
    }
    const conteudo = await download.blob();

    const form = new FormData();
    form.set('number', this.normalizarNumero(to));
    form.set('body', legenda);
    form.set('medias', conteudo, 'boleto.pdf');

    const response = await fetch(`${this.apiUrl}/api/messages/send`, {
      method: 'POST',
      // Content-Type fica por conta do runtime (boundary do multipart).
      headers: { Authorization: `Bearer ${this.apiToken}` },
      body: form,
    });
    return this.lerResposta(response);
  }
}
