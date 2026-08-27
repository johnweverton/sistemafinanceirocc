// Texto da mensagem de notificação de boleto (WhatsApp/e-mail) — GATE do dono (2026-08-04):
// a mensagem SEMPRE assina como "Carmem Cavalcante Contabilidade", independente da conta
// emissora real do boleto (MC/Cavalcante Viana). Isso é uma mudança consciente da regra da
// Story 7.2 (que assinava pela conta emissora) — o dono decidiu que, aos olhos do pagador, quem
// fala é sempre a Carmem Cavalcante Contabilidade; a distinção MC/Cavalcante Viana só importa
// no documento bancário em si (Cora), não na mensagem humana.
import type { DadosCobranca } from '@cobranca/shared';

export const NOME_REMETENTE_MENSAGEM = 'Carmem Cavalcante Contabilidade';

/** Mesma nomenclatura resolvida em `emitir-boleto.ts` (médico/empresa/cliente contábil) — o
 *  pagador de um cliente contábil paga honorários contábeis, não cobrança médica, então o corpo
 *  da mensagem não pode usar o mesmo texto para os dois serviços (achado 2026-08-27). */
export type PagadorNomenclatura = 'médico' | 'empresa' | 'cliente contábil';

/** Descrição do serviço cobrado que entra no corpo da mensagem — único ponto que decide entre
 *  "cobrança médica" (médico/empresa, Épicos 6-10) e "honorários contábeis" (cliente contábil,
 *  Épico 11). */
export function descricaoServico(pagadorNomenclatura: PagadorNomenclatura): string {
  return pagadorNomenclatura === 'cliente contábil'
    ? 'referente aos honorários contábeis'
    : 'da cobrança médica';
}

/**
 * Saudação do pagador: "Dr(a). Fulano" para médico (pessoa física — PF), só o nome/razão
 * social para empresa/cliente contábil (pessoa jurídica — PJ, nunca é "Dr." de ninguém).
 * "Dr(a)." em vez de "Dr."/"Dra." porque o cadastro não tem campo de gênero.
 */
export function saudacaoPagador(cobranca: Pick<DadosCobranca, 'pagadorTipo' | 'pagadorNome'>): string {
  return cobranca.pagadorTipo === 'PF' ? `Dr(a). ${cobranca.pagadorNome}` : cobranca.pagadorNome;
}

/** AAAA-MM-DD → DD/MM/AAAA. String pura (sem passar por Date) para não sofrer de fuso horário. */
export function formatarDataBR(isoDate: string): string {
  const [ano, mes, dia] = isoDate.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Legenda que acompanha o PDF no WhatsApp. `pixDisponivel` reflete se o boleto foi emitido
 * como híbrido (código de barras + QR Code Pix, achado 2026-08-05) — sem isso, mencionar Pix
 * seria informar uma opção que não existe de fato no PDF. */
export function montarLegendaWhatsapp(
  cobranca: Pick<DadosCobranca, 'pagadorTipo' | 'pagadorNome'>,
  vencimento: string,
  pagadorNomenclatura: PagadorNomenclatura,
  pixDisponivel = false,
): string {
  return (
    `Olá, ${saudacaoPagador(cobranca)}!\n` +
    `Segue abaixo o boleto ${descricaoServico(pagadorNomenclatura)} com o vencimento para ${formatarDataBR(vencimento)}.\n` +
    (pixDisponivel ? 'Você também pode pagar via Pix escaneando o QR Code no boleto.\n' : '') +
    `\nAt.te\n${NOME_REMETENTE_MENSAGEM}`
  );
}
