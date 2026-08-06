# Pesquisa: exportação de conciliação bancária para o Domínio Sistemas (contabilidade)

**Data:** 2026-08-06 · **Status:** pesquisa concluída, aguardando decisão para virar story

## TL;DR

- **Domínio Sistemas aceita OFX nativamente** pra conciliação bancária — é o caminho mais rápido e
  de custo zero, e cobre exatamente o dado que já temos em `extrato_transacoes`.
- **CNAB 240/400 não serve** para isso (é remessa/retorno bancário, não lançamento contábil).
- Para **exportar os lançamentos já classificados por DRE** (o ganho maior de valor), o Domínio tem
  um layout TXT próprio de importação, mas a especificação exata dos campos só é obtida com o
  escritório de contabilidade parceiro (não está publicada de forma completa).
- **Nenhuma API paga é necessária.** As opções de custo encontradas na pesquisa (SERPRO "Integra
  Contador") são de um serviço governamental não relacionado a este caso de uso.
- **Recomendação**: implementar em 2 fases — (1) exportação OFX do extrato conciliado, já
  acionável hoje; (2) exportação de lançamentos DRE no layout do Domínio, gated em confirmar o
  layout exato com o contador.

## Arquivos desta pesquisa

- [`00-query-original.md`](./00-query-original.md) — pergunta original + contexto de negócio.
- [`01-deep-research-prompt.md`](./01-deep-research-prompt.md) — decomposição em 5 sub-perguntas e
  avaliação de cobertura (1 onda, ~85/100, 9+ fontes de alta credibilidade).
- [`02-research-report.md`](./02-research-report.md) — relatório completo: o que o Domínio aceita,
  custo, especificação técnica do OFX, e como o mercado (Alterdata, Maxiprod, Trinks/Conta Azul) já
  resolve esse mesmo problema.
- [`03-recommendations.md`](./03-recommendations.md) — recomendação acionável: 2 fases, mapeamento
  exato dos nossos campos (`ExtratoTransacao`, `PlanoContas`) pros formatos de destino, estimativa
  de complexidade, e o que NÃO fazer (CNAB, SPED ECD incremental, API paga).

## Next Steps

Implementação não faz parte desta pesquisa (escopo do `tech-search`). Se aprovar a recomendação,
o próximo passo é abrir como story normal e implementar via `@dev`/`*develop` — começando pela
Fase 1 (OFX), que não tem nenhuma dependência externa pendente.
