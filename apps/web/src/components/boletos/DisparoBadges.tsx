// DisparoBadges — badges circulares de status de envio do boleto (WhatsApp/e-mail).
// Átomo: círculo 28px com o glyph da marca, verde (enviado) / vermelho (falha), tooltip
// custom no hover E no foco por teclado com data/hora (ou o erro). Molécula: uma badge
// por canal, mostrando sempre o disparo MAIS RECENTE (reenvio com sucesso substitui a
// falha antiga na leitura — o histórico completo permanece em boletos_disparos).
// Acessibilidade: aria-label carrega o mesmo texto do tooltip (cor nunca é o único sinal).
import type { DisparoBoleto } from '@cobranca/shared';

/** Glyph oficial do WhatsApp (path público, viewBox 24). */
function WhatsAppIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/** Envelope em stroke — mesmo estilo dos demais ícones do app. */
function EmailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}

function dataHoraCompleta(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CANAL_LABEL: Record<DisparoBoleto['canal'], string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
};

/** Rótulo do tipo de disparo (Épico 13) — só aparece no tooltip; emissão não é anunciada
 *  explicitamente (é o caso mais comum, o texto sem prefixo já é ela), lembrete/cobrança são. */
const TIPO_LABEL: Partial<Record<DisparoBoleto['tipo'], string>> = {
  lembrete_vencimento: 'Lembrete',
  cobranca_vencido: 'Cobrança',
};

/** Badge circular de um canal, com tooltip no hover/foco. */
function DisparoBadge({ disparo }: { disparo: DisparoBoleto }) {
  const ok = disparo.status === 'sucesso';
  const prefixoTipo = TIPO_LABEL[disparo.tipo];
  const rotuloCanal = prefixoTipo ? `${CANAL_LABEL[disparo.canal]} · ${prefixoTipo}` : CANAL_LABEL[disparo.canal];
  const texto = ok
    ? `${rotuloCanal} · enviado em ${dataHoraCompleta(disparo.enviadoEm)}`
    : `${rotuloCanal} · falha em ${dataHoraCompleta(disparo.enviadoEm)}${disparo.mensagemErro ? `. ${disparo.mensagemErro}` : ''}`;

  return (
    <span className="group relative inline-flex" tabIndex={0} aria-label={texto}>
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset ${
          ok
            ? 'bg-cc-success-soft text-cc-success ring-cc-success/25'
            : 'bg-cc-danger-soft text-cc-danger ring-cc-danger/25'
        } ${prefixoTipo ? 'opacity-80' : ''}`}
      >
        {disparo.canal === 'whatsapp' ? <WhatsAppIcon /> : <EmailIcon />}
      </span>
      {/* Tooltip: aparece no hover e no foco por teclado; some para leitores de tela (aria-label acima). */}
      <span
        role="presentation"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden max-w-64 -translate-x-1/2 whitespace-normal rounded-lg border border-cc-hairline bg-cc-surface-2 px-2.5 py-1.5 text-xs text-cc-ink shadow-lg group-hover:block group-focus-visible:block"
      >
        {texto}
      </span>
    </span>
  );
}

/**
 * Linha de badges de disparo de um boleto — uma por (canal, tipo), sempre o disparo mais recente
 * de cada combinação. A chave inclui `tipo` (Épico 13) para que um lembrete de vencimento não
 * sobrescreva visualmente a badge de emissão do mesmo canal — cada tipo de disparo tem sua
 * própria badge. Sem disparos → não renderiza nada (boleto ainda sem tentativa de envio).
 */
export function DisparoBadges({ disparos }: { disparos?: DisparoBoleto[] }) {
  if (!disparos || disparos.length === 0) return null;

  // Último disparo de cada (canal, tipo) — a lista vem ordenada do mais antigo ao mais novo.
  const porCanalETipo = new Map<string, DisparoBoleto>();
  for (const d of disparos) porCanalETipo.set(`${d.canal}:${d.tipo}`, d);

  return (
    <span className="inline-flex items-center gap-1.5">
      {[...porCanalETipo.entries()].map(([chave, d]) => (
        <DisparoBadge key={chave} disparo={d} />
      ))}
    </span>
  );
}
