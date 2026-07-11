# Arquitetura — DRE / Plano de Contas (categorização contábil)

**Autor:** Aria (@architect) · **Data:** 2026-07-11 · **Status:** Proposto — aguarda GO do dono
**Pré-requisito já entregue:** conciliação bancária (Épico 8) — o extrato sincronizado
(`extrato_transacoes`) é a fonte primária de dado; nada de recoleta.

---

## 1. Problema e valor

O Épico 8 trouxe o caixa real para dentro do sistema (extrato + conciliação + saldo), mas
ainda não responde "quanto sobrou, e de onde veio/foi". O DRE fecha esse ciclo:

1. **Toda transação do extrato categorizada** por natureza contábil (receita, tarifa,
   despesa administrativa...), não só por sentido (crédito/débito).
2. **Despesas fora da Cora entram no resultado** (aluguel, salários pagos de outra forma).
3. **Relatório por período/empresa** — resultado líquido consolidado ou por empresa (MC/CV).

## 2. Decisões fechadas (dono, 2026-07-11)

1. **DRE formal**: receita bruta → deduções da receita → despesas operacionais → despesas
   financeiras → resultado líquido (não um resumo simples de entrou/saiu).
2. **Categorização por regras + revisão manual** — mesmo espírito da fila de sugestões do
   Épico 8 (nunca auto-decide o que é ambíguo; alta confiança pode confirmar sozinho).
3. **Consolidado + drill-down por empresa** (MC/CV) — mesmo padrão do filtro de conta do
   `/extrato`.
4. **Duas fontes**: `extrato_transacoes` (Épico 8) + lançamentos manuais novos (despesas
   fora da Cora).
5. **Lançamentos manuais avulsos E recorrentes** (ex.: aluguel mensal).
6. **Plano de contas é cadastro editável** (não enum fixo em código) — proposta inicial
   aceita como ponto de partida (ver §3).

## 3. Decisões estruturais (opções e trade-offs)

### D1 — Plano de contas: cadastro próprio, hierárquico e editável

| Opção | Prós | Contras |
|-------|------|---------|
| **A (recomendada):** tabela `plano_contas` (grupo fixo + nome livre) | Editável sem deploy; grupo controla onde entra na fórmula do DRE | Precisa seed inicial + tela de cadastro |
| B: enum fixo em código | Zero schema novo | Contradiz a decisão 6 do dono (editável) |

**Decisão: A.** `grupo` é um enum fechado (é o que dá a fórmula do DRE — não pode virar
categoria livre): `receita` \| `deducao_receita` \| `despesa_operacional` \|
`despesa_financeira`. Dentro de cada grupo, `nome` é livre e editável
(ex.: "Despesas com pessoal" pode virar "Folha de pagamento" sem migration).
Duas linhas nascem como **sistema** (`sistema=true`, não deletáveis — usadas pela
auto-categorização do D3): **Receita de honorários** (grupo `receita`) e **Tarifas
bancárias** (grupo `deducao_receita`).

### D2 — Onde vive a categoria de cada transação/lançamento

`extrato_transacoes` ganha `categoria_id` (nullable, FK `plano_contas`) +
`status_categorizacao` (`sem_categoria` \| `sugerida` \| `confirmada`) — mesmo padrão de
"status + trilha" do `status_conciliacao` (Épico 8), mas é um eixo **independente**: uma
transação pode estar `conciliado_auto` (matching com boleto) e `sem_categoria` ao mesmo
tempo até o DRE rodar por cima.

`dre_lancamentos_manuais` (nova) carrega sua própria `categoria_id` — sempre exigida na
criação (não faz sentido lançar uma despesa manual sem categoria, ao contrário do extrato
sincronizado, que chega sem nenhuma).

### D3 — Motor de categorização: 2 auto-regras de sistema + regras do usuário

Engine puro novo (`server/engine/categorizacao.ts`, mesmo padrão testável do
`conciliacao.ts`), rodado depois do sync e na criação de lançamento manual:

| Origem | Condição | Resultado |
|--------|----------|-----------|
| **Sistema** (fixa, não editável) | `tipo=CREDIT` **e** `status_conciliacao` começa com `conciliado` (já tem boleto vinculado — Épico 8) | `categoria = Receita de honorários`, `status_categorizacao = confirmada` (é dedução lógica de um fato já confirmado, não uma sugestão) |
| **Sistema** (fixa, não editável) | `tipo=DEBIT` **e** `transaction_type = 'FEE'` | `categoria = Tarifas bancárias`, `status_categorizacao = confirmada` |
| **Regra do usuário** (`plano_contas_regras`) | `contraparte_nome` ou `descricao` contém o padrão cadastrado (case-insensitive, substring — sem regex, evita complexidade/ReDoS) | `categoria = <cadastrada>`, `status_categorizacao = sugerida` (SEMPRE requer confirmação — é heurística, não fato) |
| Nenhuma bateu | — | `status_categorizacao = sem_categoria` (aparece na fila) |

As duas regras de sistema cobrem a maior parte do volume de créditos/tarifas sozinhas —
a fila de revisão manual fica pequena (débitos que não são tarifa: transferências,
pagamentos genuínos) e é aí que as regras do usuário (`plano_contas_regras`) e a
categorização manual ajudam.

### D4 — Lançamentos manuais recorrentes: projeção em leitura, sem cron

| Opção | Prós | Contras |
|-------|------|---------|
| **A (recomendada):** template recorrente projetado NA LEITURA do relatório (sem materializar linha por mês) | Zero cron/job novo (Épico 8 também adiou cron); sem risco de duplicar/faltar linha por falha de job | Não dá para editar o valor de UM mês isolado sem encerrar o template |
| B: job mensal materializa uma linha real por mês | Editável por mês | Cron não existe no projeto ainda (fase 2 do Épico 8); mais uma peça de infra pra manter |

**Decisão: A**, com limitação documentada: para ajustar um mês específico (ex.: aluguel
com desconto pontual), o usuário encerra o template (`data_fim`) e lança o mês em questão
como avulso — fluxo raro, não justifica o motor de exceções por mês agora.

`dre_lancamentos_manuais.tipo_lancamento`: `avulso` (usa `data`) \| `recorrente` (usa
`dia_do_mes` + `data_inicio` + `data_fim` nullable = sem fim, cancela quando quiser). O
relatório, ao somar um intervalo `[inicio,fim]`, expande cada template recorrente em uma
instância virtual por mês dentro da interseção `[data_inicio, data_fim ?? hoje] ∩
[inicio,fim]` — mesma técnica de "calcular na leitura" já usada no `vencido` derivado
(Épico 4).

### D5 — Granularidade e escopo por empresa

**Mês de caixa** (mês da `data_transacao` do extrato / `data`-ou-`dia_do_mes` do
lançamento manual), não competência de emissão — o DRE nasce do extrato bancário, não do
boleto emitido. `conta_emissora` é **obrigatória** em `dre_lancamentos_manuais` (mesmo
lançamento fora da Cora pertence a UMA empresa) — permite o mesmo drill-down MC/CV que já
existe no `/extrato`; "consolidado" no relatório é só a soma das duas, sem estado novo.

### D6 — Papéis (RBAC)

Espelha o padrão já usado no projeto (`config-cobranca` é admin-only; `extrato`/
`recebiveis` são admin/financeiro):

| Ação | Papel |
|------|-------|
| CRUD do plano de contas + regras de categorização | **admin** (estrutura, muda a fórmula do relatório) |
| Categorizar transação, criar/editar lançamento manual, ver o relatório DRE | **admin, financeiro** |

## 4. Modelo de dados (shape — DDL detalhado com @data-engineer, migration 0023)

```
plano_contas
 ├─ id uuid pk
 ├─ grupo text NOT NULL CHECK in ('receita','deducao_receita','despesa_operacional','despesa_financeira')
 ├─ nome text NOT NULL
 ├─ sistema boolean NOT NULL DEFAULT false   -- true = seed protegido (não deleta), usado pelo D3
 ├─ ativo boolean NOT NULL DEFAULT true      -- desativar sem quebrar histórico (nunca DELETE com uso)
 ├─ ordem int NOT NULL DEFAULT 0             -- ordenação de exibição no relatório
 └─ criado_em timestamptz NOT NULL DEFAULT now()
 UNIQUE (grupo, nome)

plano_contas_regras
 ├─ id uuid pk
 ├─ categoria_id uuid NOT NULL references plano_contas(id)
 ├─ campo text NOT NULL CHECK in ('contraparte_nome','descricao')
 ├─ padrao text NOT NULL             -- substring, case-insensitive (ILIKE '%padrao%')
 ├─ prioridade int NOT NULL DEFAULT 0  -- menor primeiro; primeira regra que bate vence
 ├─ ativo boolean NOT NULL DEFAULT true
 └─ criado_em timestamptz NOT NULL DEFAULT now()

extrato_transacoes  (ALTER — aditivo sobre a tabela do Épico 8)
 ├─ + categoria_id uuid NULL references plano_contas(id)
 └─ + status_categorizacao text NOT NULL DEFAULT 'sem_categoria'
      CHECK in ('sem_categoria','sugerida','confirmada')

dre_lancamentos_manuais
 ├─ id uuid pk
 ├─ conta_emissora text NOT NULL CHECK in ('mc','cavalcante_viana')
 ├─ categoria_id uuid NOT NULL references plano_contas(id)   -- sempre exigida (§D2)
 ├─ descricao text NOT NULL
 ├─ valor numeric(12,2) NOT NULL
 ├─ tipo_lancamento text NOT NULL CHECK in ('avulso','recorrente')
 ├─ data date NULL              -- obrigatório quando avulso
 ├─ dia_do_mes int NULL CHECK (dia_do_mes between 1 and 28)  -- obrigatório quando recorrente (28 evita mês curto)
 ├─ data_inicio date NULL       -- obrigatório quando recorrente
 ├─ data_fim date NULL          -- null = sem fim (recorrente ativo indefinidamente)
 ├─ criado_por uuid NOT NULL references profiles(id)
 └─ criado_em timestamptz NOT NULL DEFAULT now()
 CHECK ( (tipo_lancamento = 'avulso' AND data IS NOT NULL AND dia_do_mes IS NULL AND data_inicio IS NULL)
      OR (tipo_lancamento = 'recorrente' AND data IS NULL AND dia_do_mes IS NOT NULL AND data_inicio IS NOT NULL) )
```

RLS espelhando `extrato_transacoes`/`config_cobranca`: leitura admin/financeiro em tudo;
escrita de `plano_contas`/`plano_contas_regras` só admin (via service role nas rotas,
`requireRole(['admin'])`); escrita de `dre_lancamentos_manuais` e `categoria_id`/
`status_categorizacao` em `extrato_transacoes` admin/financeiro.
Índices: `plano_contas_regras(ativo, prioridade)`, `extrato_transacoes(status_categorizacao)`,
`dre_lancamentos_manuais(conta_emissora, tipo_lancamento)`.

Seed da migration: as 2 linhas de sistema (`Receita de honorários` grupo `receita`,
`Tarifas bancárias` grupo `deducao_receita`) + as demais categorias da proposta do §6 do
discovery (`docs/stories/README.md`, Épico 9) como linhas normais (`sistema=false`,
editáveis/deletáveis se sem uso).

## 5. Código (mapa arquivo → mudança)

| Arquivo | Mudança |
|---------|---------|
| `packages/shared` | Tipos `PlanoContas`, `GrupoPlanoContas`, `RegraCategorizacao`, `StatusCategorizacao`, `LancamentoManual`, `TipoLancamentoManual` |
| `server/engine/categorizacao.ts` **(novo)** | Motor puro (D3) — recebe transação/lançamento + regras ativas, devolve sugestão/confirmação; testável isolado como `conciliacao.ts` |
| `server/repositories/plano-contas-repository.ts` **(novo)** | CRUD plano de contas + regras |
| `server/repositories/dre-repository.ts` **(novo)** | CRUD lançamentos manuais + agregação do relatório (soma por categoria/mês/empresa, expande recorrentes em leitura — D4) |
| `server/repositories/extrato-repository.ts` | + `categorizarTransacao`, + filtro `status_categorizacao` na listagem |
| Rotas | `GET/POST /api/plano-contas`, `PATCH/DELETE /api/plano-contas/[id]` (admin); `GET/POST/PATCH/DELETE /api/plano-contas/regras` (admin); `POST /api/extrato/[id]/categorizar` (admin/financeiro); `GET/POST/DELETE /api/dre/lancamentos` (admin/financeiro); `GET /api/dre/relatorio?periodo=&conta=` (admin/financeiro) |
| UI | Página **`/dre`** (relatório: seletor período/empresa/consolidado, tabela por grupo/categoria, resultado líquido); página **`/dre/cadastro`** (plano de contas + regras, admin); extensão de **`/extrato`** (coluna Categoria + ação "Categorizar" reaproveitando o padrão de fila do Épico 8) |

## 6. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Fila de categorização cresce sem controle (todo débito não-tarifa cai lá) | As 2 auto-regras de sistema já cobrem a maioria do volume (receita + tarifa); regras do usuário reduzem o resto rapidamente após poucas semanas de uso |
| Categoria deletada com transações vinculadas | `ativo=false` em vez de DELETE quando há uso (mesmo padrão de soft-disable de `config_cobranca`); DELETE só permitido se `ativo` e zero vínculos |
| Regra do usuário conflita com outra (2 regras batem na mesma transação) | `prioridade` decide (menor primeiro); primeira que bate vence, resto ignorado — determinístico e testável |
| Relatório com lançamento recorrente "furado" (usuário quer editar 1 mês) | Limitação documentada (D4) — encerrar template + lançar avulso; sem motor de exceção por mês na v1 |
| `dre_lancamentos_manuais.categoria_id` referenciando categoria desativada | Migration/validação na escrita: só aceita `categoria_id` com `ativo=true`; categoria existente mantém a referência (histórico não quebra) |

## 7. Épico 9 — quebra proposta (@sm detalha após o GO)

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 9.1 | Fundação: migration 0023 (plano_contas + regras + dre_lancamentos_manuais + colunas em extrato_transacoes) + seed + tipos shared + repositories básicos | migration | schema + CRUD puro, sem motor ainda |
| 9.2 | Motor de categorização (`categorizacao.ts`) + rotas (categorizar, CRUD regras, CRUD lançamentos manuais) | 9.1 | engine em camadas (D3) + expansão de recorrência em leitura (D4) |
| 9.3 | UI: página `/dre` (relatório) + `/dre/cadastro` (plano de contas/regras) + extensão do `/extrato` (coluna categoria + ação) | 9.2 | telas + testes de componente |

Sequência 9.1 → 9.2 → 9.3 (mesmo padrão sequencial do Épico 8 — cada uma consome a anterior).

## 8. Fora de escopo (explícito)

- Contas a PAGAR como módulo completo (fornecedores, vencimentos, workflow de aprovação) —
  este épico cobre só o lançamento manual de despesa para efeito do DRE.
- NFS-e (épico próprio).
- Integração com sistema contábil externo / exportação SPED.
- Exceção por mês em lançamento recorrente (editar 1 mês isolado sem encerrar o template).
- Cron de recategorização retroativa quando uma regra nova é cadastrada (a regra vale só
  para transações futuras/ainda `sem_categoria`; recategorizar o passado é ação manual).
- Gráficos/comparativo entre períodos no relatório (v1 é tabular, período único).

## 9. Pendências / perguntas ainda abertas para o dono

Nenhuma bloqueante para iniciar a 9.1 — mas vale confirmar antes da 9.3 (UI):
- Nomes finais das categorias do plano de contas (proposta do discovery é só ponto de
  partida — dono pode renomear/adicionar linhas no cadastro depois, sem impacto técnico).
- Se falta alguma categoria óbvia do dia a dia da empresa que a proposta inicial não cobre
  (ex.: pró-labore separado de salários, contador, marketing).
