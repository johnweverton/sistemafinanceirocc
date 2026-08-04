// Texto da mensagem de notificação de boleto (WhatsApp/e-mail) — GATE do dono (2026-08-04):
// a mensagem SEMPRE assina como "Carmem Cavalcante Contabilidade", independente da conta
// emissora real do boleto (MC/Cavalcante Viana). Isso é uma mudança consciente da regra da
// Story 7.2 (que assinava pela conta emissora) — o dono decidiu que, aos olhos do médico, quem
// fala é sempre a Carmem Cavalcante Contabilidade; a distinção MC/Cavalcante Viana só importa
// no documento bancário em si (Cora), não na mensagem humana. Ver email-gateway.test.ts.
import type { DadosCobranca } from '@cobranca/shared';

export const NOME_REMETENTE_MENSAGEM = 'Carmem Cavalcante Contabilidade';

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

/** Legenda que acompanha o PDF no WhatsApp. */
export function montarLegendaWhatsapp(
  cobranca: Pick<DadosCobranca, 'pagadorTipo' | 'pagadorNome'>,
  vencimento: string,
): string {
  return (
    `Olá, ${saudacaoPagador(cobranca)}!\n` +
    `Segue abaixo o boleto da cobrança médica com o vencimento para ${formatarDataBR(vencimento)}.\n\n` +
    `At.te\n${NOME_REMETENTE_MENSAGEM}`
  );
}
