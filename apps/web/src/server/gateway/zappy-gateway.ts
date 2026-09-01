// Zappy (ZapContábil) Gateway — envio de WhatsApp via API Whaticket.
//
// CONTRATO REAL (reconfirmado em 2026-08-03 com o SUPORTE da Zappy + Swagger de `/api-docs` —
// o contrato de 2026-07-31 (POST /api/messages/multiple/{numero}) existe na doc mas falhava em
// produção com 400 ERR_NO_CONNECTED_CONNECTION_WAS_FOUND mesmo com uma conexão CONNECTED/isDefault
// em /api/connections. O suporte apontou o par de rotas abaixo, EXIGINDO `connectionFrom` sempre —
// testado e confirmado (mensagem de texto + PDF chegaram de fato no WhatsApp). Se voltar a
// quebrar, reconsulte {ZAPPY_API_URL}/api-docs e NÃO assuma que o contrato documentado é o mesmo
// de ontem — já foi assim 2 vezes (Épico 5, e aqui):
//   - O host do painel (carmemcontabilidade.zapcontabil.chat) é o FRONTEND — devolve HTML 200
//     para qualquer path, inclusive /api/* (por isso o parse de JSON falhava com "<!DOCTYPE").
//   - A API fica em host separado com prefixo `api-`: https://api-carmemcontabilidade.zapcontabil.chat
//     (GET / → {"status":true,"version":"..."}). ZAPPY_API_URL deve apontar para ELE.
//   - Texto:  POST /api/send/{numero}          JSON      { body, connectionFrom }
//   - Mídia:  POST /api/send/{type}/{numero}    multipart { media (binário), caption, connectionFrom }
//     (`type` ∈ image|video|audio|voice|document)
//   - `connectionFrom` (integer, id de `GET /api/connections`) é OBRIGATÓRIO na prática: a API
//     até documenta um fallback pra conexão padrão quando omitido, mas foi omitindo esse campo
//     que o endpoint anterior (messages/multiple) nunca achava a conexão. Vem de
//     `ZAPPY_CONNECTION_ID` (lib/env.ts).
import { getServerEnv } from '@/lib/env';

export class ZappyGateway {
  private apiUrl: string;
  private apiToken: string;
  private connectionId: number;

  constructor() {
    const env = getServerEnv();
    if (!env.ZAPPY_API_URL || !env.ZAPPY_API_TOKEN) {
      throw new Error('Variáveis ZAPPY_API_URL ou ZAPPY_API_TOKEN não configuradas.');
    }
    if (!env.ZAPPY_CONNECTION_ID) {
      throw new Error(
        'Variável ZAPPY_CONNECTION_ID não configurada. É obrigatória para o envio achar a ' +
          'conexão certa (ver GET /api/connections e o cabeçalho deste arquivo).',
      );
    }
    this.apiUrl = env.ZAPPY_API_URL.replace(/\/$/, '');
    this.apiToken = env.ZAPPY_API_TOKEN;
    this.connectionId = env.ZAPPY_CONNECTION_ID;
  }

  /**
   * Normaliza número BR para o formato aceito pelo Whaticket (dígitos, com DDI).
   * "(85) 99999-9999" → "5585999999999". Se já vier com 55, mantém.
   * ID de grupo (ex.: "558597180005-1552156770") passa direto — o hífen faz parte do ID
   * e é assim que o Whaticket reconhece "isso é um grupo" (vira `<isso>@g.us` no backend).
   * Removê-lo (como o `\D` global fazia antes) concatena os dois números e produz um
   * contato inexistente → 400 ERR_WAPP_INVALID_CONTACT.
   *
   * Achado 2026-09-02: a checagem original (`includes('-')`) confundia um telefone PF cadastrado
   * com máscara humana (ex. "(85) 98721-6266" — tem hífen no meio do número) com um ID de grupo, e
   * devolvia a string COM parênteses/espaço sem normalizar, quebrando o envio. Um ID de grupo real
   * é só dígitos dos dois lados do hífen, sem nenhuma outra pontuação — é essa forma exata que
   * precisa passar direto; qualquer outra coisa com hífen é telefone formatado e cai na
   * normalização normal.
   */
  private normalizarNumero(to: string): string {
    const semEspacos = to.trim();
    if (/^\d+-\d+$/.test(semEspacos)) return semEspacos;
    const digitos = semEspacos.replace(/\D/g, '');
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
    const response = await fetch(`${this.apiUrl}/api/send/${this.normalizarNumero(to)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({ body: text, connectionFrom: this.connectionId }),
    });
    return this.lerResposta(response);
  }

  /**
   * Envia um documento a partir de uma URL pública (ex: PDF do boleto da Cora).
   * O arquivo é baixado aqui e enviado no campo `media` (contrato Whaticket atual, ver
   * cabeçalho do arquivo) — a API não busca URLs remotas por conta própria neste endpoint.
   * @param to Número de destino (ex: 5585999999999) ou ID do grupo
   * @param url URL pública do documento PDF
   * @param legenda Texto que acompanha o documento (caption) — ver `montarLegendaWhatsapp` em
   *   mensagem-boleto.ts para o texto padrão de disparo de boleto.
   */
  async enviarDocumentoPorUrl(to: string, url: string, legenda: string) {
    const download = await fetch(url);
    if (!download.ok) {
      throw new Error(`Falha ao baixar o documento para envio (${download.status}): ${url}`);
    }
    const conteudo = await download.blob();

    const form = new FormData();
    form.set('media', conteudo, 'boleto.pdf');
    form.set('caption', legenda);
    form.set('connectionFrom', String(this.connectionId));

    const response = await fetch(`${this.apiUrl}/api/send/document/${this.normalizarNumero(to)}`, {
      method: 'POST',
      // Content-Type fica por conta do runtime (boundary do multipart).
      headers: { Authorization: `Bearer ${this.apiToken}` },
      body: form,
    });
    return this.lerResposta(response);
  }
}
