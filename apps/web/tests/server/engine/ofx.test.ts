import { describe, it, expect } from 'vitest';
import { gerarOfx, type TransacaoParaOfx } from '../../../src/server/engine/ofx';

const periodo = { inicio: '2026-07-01', fim: '2026-07-31' };

function baseTransacao(): TransacaoParaOfx {
  return {
    entryId: 'entry-1',
    tipo: 'CREDIT',
    valor: 1250,
    dataTransacao: '2026-07-03T14:30:00Z',
    contraparteNome: 'Fulano de Tal',
    descricao: 'Pagamento boleto',
  };
}

describe('gerarOfx', () => {
  it('gera cabeçalho OFX válido com conta e período', () => {
    const ofx = gerarOfx([], periodo, 'CORA-MC');
    expect(ofx).toContain('OFXHEADER:100');
    expect(ofx).toContain('<OFX>');
    expect(ofx).toContain('<ACCTID>CORA-MC');
    expect(ofx).toContain('<DTSTART>20260701');
    expect(ofx).toContain('<DTEND>20260731');
    expect(ofx).toContain('</OFX>');
  });

  it('CREDIT vira TRNAMT positivo (valor sempre chega positivo do nosso banco)', () => {
    const ofx = gerarOfx([{ ...baseTransacao(), tipo: 'CREDIT', valor: 1250 }], periodo, 'CORA-MC');
    expect(ofx).toContain('<TRNTYPE>CREDIT');
    expect(ofx).toContain('<TRNAMT>1250.00');
  });

  it('DEBIT vira TRNAMT negativo (aplica o sinal — valor não vem negativo do banco)', () => {
    const ofx = gerarOfx([{ ...baseTransacao(), tipo: 'DEBIT', valor: 170 }], periodo, 'CORA-MC');
    expect(ofx).toContain('<TRNTYPE>DEBIT');
    expect(ofx).toContain('<TRNAMT>-170.00');
  });

  it('FITID = entryId (idempotência de reimportação no sistema contábil)', () => {
    const ofx = gerarOfx([{ ...baseTransacao(), entryId: 'ent_abc123' }], periodo, 'CORA-MC');
    expect(ofx).toContain('<FITID>ent_abc123');
  });

  it('DTPOSTED usa só a parte de data do ISO (sem hora)', () => {
    const ofx = gerarOfx([{ ...baseTransacao(), dataTransacao: '2026-07-15T09:05:00.000Z' }], periodo, 'CORA-MC');
    expect(ofx).toContain('<DTPOSTED>20260715');
  });

  it('NAME usa contraparteNome; MEMO usa descricao', () => {
    const ofx = gerarOfx(
      [{ ...baseTransacao(), contraparteNome: 'Dr. Fulano', descricao: 'Pagamento de honorários' }],
      periodo,
      'CORA-MC',
    );
    expect(ofx).toContain('<NAME>Dr. Fulano');
    expect(ofx).toContain('<MEMO>Pagamento de honorários');
  });

  it('sem contraparteNome, NAME cai pra descricao; sem nenhum dos dois, usa fallback', () => {
    const semContraparte = gerarOfx(
      [{ ...baseTransacao(), contraparteNome: null, descricao: 'Taxa boleto' }],
      periodo,
      'CORA-MC',
    );
    expect(semContraparte).toContain('<NAME>Taxa boleto');

    const semNada = gerarOfx(
      [{ ...baseTransacao(), contraparteNome: null, descricao: null }],
      periodo,
      'CORA-MC',
    );
    expect(semNada).toContain('<NAME>Sem identificação');
  });

  it('escapa & < > em nome/descrição (SGML não tolera esses caracteres crus)', () => {
    const ofx = gerarOfx(
      [{ ...baseTransacao(), contraparteNome: 'A & B <Ltda>', descricao: null }],
      periodo,
      'CORA-MC',
    );
    expect(ofx).toContain('<NAME>A &amp; B &lt;Ltda&gt;');
    expect(ofx).not.toContain('<NAME>A & B <Ltda>');
  });

  it('lote vazio gera arquivo válido sem transações (saldo líquido 0.00)', () => {
    const ofx = gerarOfx([], periodo, 'CORA-CV');
    expect(ofx).not.toContain('<STMTTRN>');
    expect(ofx).toContain('<BALAMT>0.00');
  });

  it('saldo líquido (LEDGERBAL) soma créditos menos débitos do lote exportado', () => {
    const ofx = gerarOfx(
      [
        { ...baseTransacao(), entryId: 'e1', tipo: 'CREDIT', valor: 1000 },
        { ...baseTransacao(), entryId: 'e2', tipo: 'DEBIT', valor: 300 },
      ],
      periodo,
      'CORA-MC',
    );
    expect(ofx).toContain('<BALAMT>700.00');
  });

  it('múltiplas transações geram múltiplos blocos STMTTRN, um por transação', () => {
    const ofx = gerarOfx(
      [
        { ...baseTransacao(), entryId: 'e1' },
        { ...baseTransacao(), entryId: 'e2' },
        { ...baseTransacao(), entryId: 'e3' },
      ],
      periodo,
      'CORA-MC',
    );
    expect(ofx.match(/<STMTTRN>/g)).toHaveLength(3);
    expect(ofx.match(/<\/STMTTRN>/g)).toHaveLength(3);
  });
});
