// Geração de arquivo OFX (Open Financial Exchange) do extrato conciliado — Fase 1 da
// exportação financeiro→contábil (pesquisa em docs/research/2026-08-06-...). Formato SGML 1.x
// (mais simples de gerar/tolerante que o XML 2.0+, amplamente aceito, inclusive pelo Domínio
// Sistemas no módulo de conciliação bancária, que usa MEMO/NAME para identificar cada
// lançamento). Função pura — sem I/O, mesmo padrão dos outros módulos do engine.
export interface TransacaoParaOfx {
  /** Id da transação na origem (Cora) — vira FITID, evita duplicar na reimportação. */
  entryId: string;
  tipo: 'CREDIT' | 'DEBIT';
  /** Sempre positivo (é assim que a Cora entrega e que gravamos) — o sinal é aplicado aqui. */
  valor: number;
  /** ISO 8601. */
  dataTransacao: string;
  contraparteNome: string | null;
  descricao: string | null;
}

/** Escapa os únicos caracteres problemáticos em SGML (o parser do Domínio não é XML estrito). */
function escaparTexto(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ISO 8601 → YYYYMMDD (data local do evento, sem componente de hora). */
function dataOfx(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}

/** Timestamp de geração do arquivo, YYYYMMDDHHmmss. */
function agoraOfx(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Valor monetário com 2 casas, ponto decimal (nunca vírgula — SGML/OFX é locale-fixo). */
function valorOfx(v: number): string {
  return v.toFixed(2);
}

/**
 * Gera o corpo de um arquivo OFX (SGML 1.x) representando o extrato de UMA conta num período.
 * `acctId` identifica a conta pro Domínio distinguir qual das 4 contas emissoras é essa — como
 * não guardamos o número real da conta bancária, usa o slug da conta emissora (ex.: "CORA-MC");
 * o pareamento efetivo do lado do Domínio é configurado manualmente pelo contador na primeira
 * importação (mesmo processo que ele já faz pra qualquer banco novo).
 *
 * `LEDGERBAL` é exigido pelo formato mas NÃO é o saldo real do banco (não temos saldo
 * ponto-no-tempo confiável pra data final do período aqui) — é a soma líquida das transações
 * do arquivo, só pra manter o arquivo sintaticamente válido. A conciliação de fato é
 * transação-a-transação (por isso os `STMTTRN`), não por saldo.
 */
export function gerarOfx(
  transacoes: TransacaoParaOfx[],
  periodo: { inicio: string; fim: string },
  acctId: string,
): string {
  const dtStart = periodo.inicio.replace(/-/g, '');
  const dtEnd = periodo.fim.replace(/-/g, '');
  const dtServer = agoraOfx();

  const saldoLiquido = transacoes.reduce(
    (acc, t) => acc + (t.tipo === 'CREDIT' ? t.valor : -t.valor),
    0,
  );

  const linhasTransacoes = transacoes
    .map((t) => {
      const sinal = t.tipo === 'CREDIT' ? 1 : -1;
      const nome = escaparTexto(t.contraparteNome ?? t.descricao ?? 'Sem identificação');
      const memo = escaparTexto(t.descricao ?? t.contraparteNome ?? '');
      return [
        '<STMTTRN>',
        `<TRNTYPE>${t.tipo}`,
        `<DTPOSTED>${dataOfx(t.dataTransacao)}`,
        `<TRNAMT>${valorOfx(sinal * t.valor)}`,
        `<FITID>${escaparTexto(t.entryId)}`,
        `<NAME>${nome}`,
        `<MEMO>${memo}`,
        '</STMTTRN>',
      ].join('\n');
    })
    .join('\n');

  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${dtServer}
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0000
<ACCTID>${escaparTexto(acctId)}
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${dtStart}
<DTEND>${dtEnd}
${linhasTransacoes}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${valorOfx(saldoLiquido)}
<DTASOF>${dtServer}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
}
