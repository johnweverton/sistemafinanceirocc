# Decomposição (Fase 2)

## Tópico principal

Como exportar dados de conciliação bancária/DRE do Sistema Financeiro para o Domínio Sistemas
(ou sistemas contábeis brasileiros em geral), em qual formato, com qual custo e complexidade.

## Sub-queries (5, estratégia paralela — 1 onda, cobertura suficiente)

1. **Layout de importação de lançamentos contábeis do Domínio Sistemas** — existe formato
   proprietário documentado? SPED ECD é entrada ou saída no Domínio?
2. **OFX no Domínio + relevância do CNAB** — Domínio aceita OFX para conciliação bancária? CNAB
   240/400 serve para lançamento contábil ou só remessa/retorno bancário?
3. **Custo de integração/API do Domínio** — existe API oficial (Domínio Integra/WebService/EDI)
   para enviar lançamentos automaticamente? Tem custo adicional?
4. **Especificação técnica do OFX** (devil's advocate / expert-level, ângulo de implementação) —
   tags STMTTRN/TRNTYPE/DTPOSTED/TRNAMT/FITID/MEMO, e bibliotecas Node.js/TypeScript para GERAR
   (não só ler) arquivos OFX.
5. **Como o mercado resolve isso** (expert-level, panorama competitivo) — como outros ERPs/fintechs
   brasileiros (Alterdata, Maxiprod, Trinks/Conta Azul) exportam do financeiro para o contábil.

## Cobertura obtida (Fase 4 — Evaluate Coverage)

- **1 onda foi suficiente** — coverage_score estimado ~85/100, 9+ fontes HIGH credibility
  (documentação oficial de suporte Domínio, Thomson Reuters, TecnoSpeed/FEBRABAN sobre CNAB,
  especificação OFX, e páginas de ajuda de 3 concorrentes/adjacentes: Alterdata, Maxiprod, Trinks).
- Decisão: **STOP** (HARD STOP — coverage ≥80 e ≥3 fontes HIGH). Não foi necessária 2ª onda.
- Gap residual (documentado, não bloqueante): a especificação EXATA campo-a-campo do layout TXT
  proprietário do Domínio (delimitador `|`, tipos de registro) só é acessível dentro do próprio
  sistema (arquivo de configuração XML carregado via o menu de importação) ou pedindo ao
  escritório de contabilidade parceiro — não há especificação pública completa e definitiva
  fora do produto. Ver `03-recommendations.md` para como fechar esse gap sem bloquear o início
  da implementação.
