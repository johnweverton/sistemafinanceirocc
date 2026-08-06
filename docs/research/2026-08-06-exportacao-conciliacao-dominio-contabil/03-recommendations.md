# Recomendações

> Este documento é só pesquisa e recomendação — **nenhum código de produção foi escrito aqui**.
> Para implementar, usar o fluxo normal de story/dev deste projeto (`@dev`, `*develop`, ou pedir
> diretamente pra implementar como qualquer outra tarefa).

## Recomendação: 2 exportações complementares, ambas de custo zero, em 2 fases

### Fase 1 (recomendada para começar) — Exportação **OFX** do extrato conciliado

**Por quê primeiro:** é o caminho com especificação 100% conhecida (padrão aberto, sem
ambiguidade), o Domínio já aceita nativamente sem nenhuma configuração do lado deles, e cobre
exatamente o dado que já temos pronto em `extrato_transacoes` — não depende de nenhuma informação
que falte confirmar com o escritório de contabilidade.

**Fonte dos dados**: `ExtratoTransacao` (`packages/shared/src/types/extrato.ts`), filtrado por
`contaEmissora` + período — provavelmente um botão "Exportar OFX" na tela `/extrato`
(`ExtratoManager.tsx`), ao lado do "Sincronizar" que já existe.

**Mapeamento de campos** (nosso schema → OFX `<STMTTRN>`):

| Nosso campo | Tag OFX | Observação |
|---|---|---|
| `entryId` | `FITID` | já é o id único da Cora — perfeito para idempotência de reimportação |
| `tipo` (`CREDIT`/`DEBIT`) | `TRNTYPE` | mapeamento direto |
| `dataTransacao` | `DTPOSTED` | converter ISO → `YYYYMMDD` |
| `valor` | `TRNAMT` | **aplicar sinal**: negativo se `tipo === 'DEBIT'`, positivo se `CREDIT` (hoje `valor` provavelmente já vem sem sinal — conferir) |
| `contraparteNome` | `NAME` | truncar/normalizar se necessário |
| `descricao` | `MEMO` | é o campo que o Domínio prioriza na tela — vale caprichar aqui, talvez concatenando `descricao` + nome da categoria DRE (`plano_contas.nome`) pra já dar contexto ao contador |

**Escopo natural**: 1 arquivo OFX por conta emissora por exportação (o cabeçalho OFX tem 1
`<BANKACCTFROM>` por statement — como já filtramos por `contaEmissora`, isso cai direto).

**Complexidade estimada**: baixa. Não precisa de biblioteca nova — o formato SGML 1.x é gerável
com template string simples (ver exemplo na seção 3 do relatório). Trabalho real: 1 função pura
de serialização (`gerarOfx(transacoes, contaEmissora, periodo): string`, testável com os "casos de
ouro" que o projeto já usa em outros lugares do engine) + 1 rota de API que devolve o arquivo com
`Content-Type: application/x-ofx` + 1 botão na UI. Ordem de grandeza: **1 story pequena/média**,
similar em tamanho às stories de export já existentes no projeto.

### Fase 2 — Exportação de **lançamentos contábeis classificados (DRE)**

**Por quê depois:** o valor é maior (elimina o lançamento manual duplo de verdade, não só a
conciliação bancária), mas depende de uma informação que só o escritório de contabilidade parceiro
tem: a especificação exata do layout de importação do Domínio deles (delimitador, campos, e o
mapeamento entre `plano_contas.id`/`nome` do nosso sistema e o código de conta contábil no plano de
contas DELES). Essa etapa manual/de descoberta não bloqueia a Fase 1 — pode rodar em paralelo.

**Como destravar o gap** (ação prática, não técnica): pedir ao escritório de contabilidade para,
dentro do próprio Domínio deles, exportar/compartilhar o "Conjunto de Dados" (arquivo de
configuração XML mencionado na pesquisa) que eles já usam pra importar lançamentos de outras
fontes — ou simplesmente pedir um exemplo de arquivo TXT que ELES conseguem importar com sucesso
hoje (mesmo que gerado manualmente por eles). Isso dá a especificação real e testável, sem depender
de documentação pública incompleta.

**Mapeamento de dados** (nosso schema → lançamento contábil):

| Nosso campo | Papel no lançamento | Observação |
|---|---|---|
| `ExtratoTransacao.dataTransacao` | Data do lançamento | |
| `ExtratoTransacao.valor` | Valor | |
| `ExtratoTransacao.tipo` + sinal | Débito ou Crédito | |
| `ExtratoTransacao.categoriaId` → `PlanoContas.nome`/`grupo` | Conta contábil | **precisa de uma tabela de DE-PARA** entre `plano_contas.id` (nosso) e o código da conta no Domínio — não existe hoje; é a peça de configuração nova mais importante desta fase |
| `ExtratoTransacao.contraparteNome` / `contraparteDocumento` | Histórico / CPF-CNPJ | |
| `contaEmissora` | Qual CNPJ/empresa no Domínio | já mapeável 1:1 (4 contas → 4 empresas conhecidas) |

**Complexidade estimada**: média — a lógica de geração do arquivo em si é parecida com a da Fase 1
(serialização de texto a partir de dados que já temos), mas precisa de: (a) a nova tela/tabela de
mapeamento `plano_contas → conta contábil Domínio` (cadastro simples, 1 conta emissora por vez), e
(b) validação de que todo lançamento a exportar tem categoria preenchida (senão bloquear a
exportação e apontar o que falta categorizar — mesmo espírito de "nunca chuta valor" já usado em
outras partes do motor deste projeto).

### Não fazer

- **CNAB 240/400**: não se aplica, é formato banco↔empresa para boletos/pagamentos, não lançamento
  contábil (confirmado por 2 fontes independentes).
- **SPED ECD como mecanismo de exportação incremental**: tecnicamente às vezes importável no
  Domínio, mas é pensado pra fechamento de período inteiro/migração de sistema, não para "toda
  conciliação eu exporto o que mudou". Overkill e mal-ajustado ao caso de uso.
- **API/integração paga**: nenhuma das opções pagas encontradas (SERPRO Integra Contador) resolve
  este problema — é um serviço governamental não relacionado. Não há necessidade de orçamento
  adicional para esta feature.

## Estimativa de valor entregue

- Fase 1 (OFX) sozinha já elimina o trabalho manual de digitar/conferir extrato bancário no
  Domínio pro contador — ele só importa o arquivo e concilia lá também (redundante com a nossa
  conciliação, mas eliminado o retrabalho de digitação).
- Fase 2 é o ganho maior: elimina o double-entry real (contador não precisa mais lançar
  manualmente o que já foi categorizado/conciliado aqui) — mas só vale a pena depois de validar o
  layout exato com o escritório, pra não construir em cima de suposição.

## Próximos passos

1. Confirmar com o usuário: seguir com Fase 1 primeiro (recomendado)?
2. Em paralelo (não bloqueia o dev): pedir ao escritório de contabilidade um arquivo de exemplo do
   layout de importação de lançamentos que eles já usam no Domínio, para destravar a Fase 2.
3. Quando aprovado, abrir como story normal do projeto e implementar via `@dev`/`*develop` (fora do
   escopo desta pesquisa).
