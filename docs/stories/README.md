# Épico 3 — Dados de Cobrança do Pagador + Emissão de Boletos Cora

**Fonte de verdade:** `docs/architecture/feature-dados-cobranca-boleto.md`
**Objetivo:** desbloquear a Fase 3 (emissão de boletos). Hoje o `cora-gateway` monta o pagador só
com nome + CPF; o boleto registrado do Cora exige e-mail + endereço + documento (CPF/CNPJ) +
condições comerciais. Sem isso, ligar `GATEWAY_EMISSAO_HABILITADA` causa rejeição na 1ª emissão.

## Decisões fechadas (arquitetura §10)
1. Médicos faturam **PF e PJ** (ambos; `pagadorTipo` sempre editável).
2. **Vencimento parametrizável** (`config_cobranca.dias_vencimento` default 30 + override por médico).
3. **Incluir multa/juros/desconto** (`payment_terms` do Cora).
4. **CSV de importação estendido** com colunas de cobrança opcionais.

## Pré-requisito operacional
Migration `supabase/migrations/0006_dados_cobranca.sql` **já entregue** (@data-engineer) — o dono
roda manualmente no Supabase (conta externa). As stories assumem o schema aplicado.

## Stories

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 3.1 | Fundação: contratos, domínio e persistência | migration 0006 | `packages/shared` + mappers + repositories + Zod |
| 3.2 | Emissão: gateway Cora + guard de cobrança | 3.1 | `cora-gateway` payload + `payment_terms` + guard 422 |
| 3.3 | UI: cobrança no MedicoForm + ViaCEP + Config de Cobrança | 3.1 | Formulários e tela de configuração |
| 3.4 | Importação CSV estendida com dados de cobrança | 3.1 | `parseCsv` + modelo CSV |

3.2, 3.3 e 3.4 são paralelizáveis após 3.1.

## Fora de escopo (feature flag)
Ligar `GATEWAY_EMISSAO_HABILITADA=true` e o certificado mTLS da Cora seguem como gates externos
(PRD §10) — não fazem parte deste épico.

---

# Épico 4 — Ciclo Financeiro (baixa por webhook + Contas a Receber + Dashboard)

**Fonte de verdade:** `docs/architecture/feature-ciclo-financeiro.md`
**Objetivo:** fechar o ciclo emite→recebe→enxerga. O Cora envia webhook quando o boleto é pago;
consumimos para dar baixa e derivar recebíveis/dashboard.

## Decisões fechadas
- Confiança no webhook: token no path **+ reconsulta na API Cora** (não confia no payload).
- `vencido` = **derivado on-read** (`vencimento < hoje` e sem baixa); status materializados
  `emitido`/`falha`/`pago`/`cancelado`.
- Faseamento: **Sub-épico A** (4.1–4.4) → **Sub-épico B** (4.5–4.6).

## Pré-requisito operacional
Migration `supabase/migrations/0007_ciclo_financeiro.sql` **já entregue** (@data-engineer) — dono
roda manualmente. As stories assumem o schema aplicado.

## Stories

| # | Story | Sub-épico | Depende de | Foco |
|---|-------|:---------:|-----------|------|
| 4.1 | Fundação: tipos/mappers/repositório da baixa | A | migration 0007 | `shared` + mappers + boleto-repository |
| 4.2 | Gateway `consultarInvoice` + persistir vencimento | A | 4.1 | cora/mock gateway + emissão grava `vencimento` |
| 4.3 | Webhook de baixa do Cora | A | 4.1, 4.2 | rota `/api/webhooks/cora/[secret]` + middleware |
| 4.4 | Contas a Receber | A | 4.1 | view `vw_recebiveis` + página `/recebiveis` |
| 4.5 | Agregações do dashboard (RPC/views) | B | 4.4 | @data-engineer + repositório |
| 4.6 | Página do Dashboard financeiro | B | 4.5 | `/dashboard` (KPIs + aging) |

4.2/4.4 paralelizáveis após 4.1; 4.3 após 4.2; Sub-épico B após A.

## Fora de escopo
Registrar a URL de webhook no Cora e ligar a emissão (`GATEWAY_EMISSAO_HABILITADA`) seguem como
ações externas de @devops/negócio quando a emissão for a produção.

---

# Épico 5 — Integração com a API real do Sistema Web (médicos + produções)

**Fonte de verdade:** `docs/architecture/feature-integracao-api-financeiro.md`
**Contrato externo:** `docs/integracao/api-financeiro-sistema-web.md` (documentação entregue pelo programador do sistema web)
**Objetivo:** substituir a entrada manual/CSV de produção pela API real do Sistema Web
(Carmem Cavalcante): sincronizar médicos e importar produções/itens direto da origem.

## Descoberta crítica (define o escopo)
O client existente (`apps/web/src/server/integration/procedimentos-client.ts`) foi construído sobre
o contrato **presumido** do PRD §6.4 (`GET /api/procedimentos?cpf=&competencia=`, campos
`numero_atendimento`/`senha_procedimento`/`tipo M-A1-A2`). A API **real** entrega recursos e
semântica diferentes: `fin-clientes` (sem CPF, sem especialidade) → `fin-producoes` (produções
nomeadas, ex. "Janeiro 2026") → `fin-itens` (`date`, `patient_name`, `proc_code`, `status`,
`via_acesso`, `charged_val`, `paid_val`). **Não é "ligar a chave"**: exige adaptar a camada de
integração e revisar a regra de contagem, que hoje filtra por `numeroAtendimento`+`senha`
(campos que não existem na API real).

## Decisões fechadas (dono)
1. Importação cria médico incompleto (`necessitaConfiguracao=true`); o guard de emissão (422)
   já bloqueia boleto até completar o cadastro — estado previsto, sem gambiarra.
2. UI de pendências de cadastro (filtro/badge "incompleto para cobrança" via `cobrancaCompleta()`);
   completude individual pelo MedicoForm/ViaCEP (story 3.3).
3. CSV estendido (story 3.4) permanece como via de completude **em massa** na carga inicial.
4. UUID externo (`external_id`) é a chave de vínculo permanente com a origem. CPF no
   `fin-clientes` foi solicitado ao programador (resposta pendente) — **o épico não bloqueia nisso**.
5. **Todas as guias entram na cobrança**, independente do status da origem (Devidamente Pago /
   Glosado / Recurso / Aguardando Fechamento). Única regra especial: `via_acesso = "Sim"` agrupa
   itens do mesmo paciente/atendimento em **uma** guia.
6. Credenciais só em ambiente: `API_FINANCEIRO_URL` / `API_FINANCEIRO_KEY` em
   `apps/web/.env.local` + painel Vercel. Nunca versionadas.
7. **Seleção manual da produção** na tela de execução (sem mapeamento automático
   nome↔competência): o usuário escolhe médico → produção listada pela API. (ex-Q1)
8. **Preço segue interno**: o valor cobrado continua vindo da tabela de preços do sistema
   (engine `precos.ts`); `charged_val`/`paid_val` da origem são apenas informativos. (ex-Q5)
9. **Matching assistido na carga inicial**: sem CPF na API, o sistema sugere pares
   (médico da API ↔ cadastro existente, por similaridade de nome) e o usuário confirma;
   sem par sugerido/confirmado, cria médico novo vinculado por `external_id`. (ex-Q3)
10. **`production_type` deriva `statusHapvida`**: "Produção Credenciada" → `credenciado`,
    "Produção VH" → `nao_credenciado` (confirmado pelo dono 2026-07-06); preenchido
    automaticamente na importação. (ex-Q4)
11. **Regra do pediatra mantida** (teto n/3): via de acesso é independente da regra do pediatra;
    interação das duas regras especificada na arquitetura §3.3.

## Questões abertas
- **Q2 resolvida na arquitetura (§3.3):** contagem nova em `contagem-producao.ts` — grupo
  `via_acesso` por (paciente, data) = 1 guia; item sem `via_acesso` = 1 guia; status nunca filtra.
  Restam 3 decisões de negócio no §10 da arquitetura (pediatra n/3, mapeamento do VH,
  campo de agrupamento explícito na origem).

## Pré-requisitos operacionais
- Migration `0011_integracao_api_financeiro.sql` (`external_id`, `cpf` nullable + UNIQUE parcial,
  snapshot de seleções) — @data-engineer (arquitetura §4).
- **Pendências externas (programador da origem, pedidas 2026-07-06):** CPF no `fin-clientes` +
  senha/nº de atendimento no `fin-itens`. Não bloqueiam 5.1–5.4; o **cutover (5.5) deve
  preferencialmente esperar o campo de atendimento** (fallback paciente+data subconta guias —
  arquitetura §10.3).
- URL base e chave da API entregues pelo programador — dono configura nos ambientes.

## Stories (proposta — @sm detalha após a arquitetura)

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 5.1 | Client da API real + tipos do contrato | arquitetura | `fin-clientes/producoes/itens`, retry/timeout/401, camada anti-corrupção |
| 5.2 | Sincronização de médicos (`external_id`) | 5.1, migration | importar/vincular médicos, `necessitaConfiguracao=true` |
| 5.3 | Contagem sob a semântica real | 5.1, Q2 | engine: `via_acesso`, todos os status, testes de paridade |
| 5.4 | UI de pendências de cadastro | — (paralela) | filtro/badge + fluxo de completude |
| 5.5 | Execução por produção | 5.1–5.3 | orchestrator + seleção manual de produção na UI (decisão 7) |

5.4 é paralelizável desde já; 5.2 e 5.3 paralelizáveis após 5.1; 5.5 fecha o épico.

## Fora de escopo
- CPF no endpoint `fin-clientes` (dependência externa; quando chegar, vira melhoria do matching).
- Ligar emissão/webhook em produção (gates dos Épicos 3–4).
- Qualquer escrita na API do sistema web (contrato é read-only).

---

# Épico 6 — Melhorias operacionais (feedback da coordenação)

**Fonte:** reunião de apresentação do sistema à coordenação (2026-07-08).
**Objetivo:** cobrir duas lacunas operacionais do fluxo de cobrança: correção de boleto
emitido com erro (cancelar + reemitir dentro do sistema) e a regra real de cobrança dos
médicos auxiliares (percentual da produção mensal em vez de faixas por guias).

## Decisões fechadas
- Cancelamento é sempre **cancelar + reemitir** (nunca edição de boleto); boleto pago não
  se cancela; reconsulta na Cora antes de cancelar (fonte da verdade).
- Percentual de produção é **configurável por médico**; modo default de todos os médicos
  segue `faixa_guias`.
- **GATE da 6.2 respondido pelo dono (2026-07-08):** base do percentual = valor **cobrado**
  (`charged_val` — valor de produção, não o efetivamente pago); **glosados entram** na base;
  5% é **especificidade dos médicos auxiliares atuais**, não padrão do sistema (campo por
  médico, sem valor default).

## Stories

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 6.1 | Cancelamento e reemissão de boleto | Épico 4 (baixa) | porta `cancelar` + rota + reemissão liberada + UI |
| 6.2 | Modo de cobrança percentual da produção | Épico 5 (itens com valores) + GATE | cadastro do médico + ramo no engine + UI |

6.1 e 6.2 são independentes e paralelizáveis. Cada uma tem sua migration
(numeração definida na implementação, após a 0016).

## Fora de escopo
- Conciliação bancária / plano de contas / DRE (candidata a épico próprio — em discovery
  com a coordenação, sem spec).
- Cancelamento em lote e estorno de boleto pago.

---

# Épico 7 — Multi-Conta Emissora (MC + Cavalcante Viana)

**Fonte de verdade:** `docs/architecture/feature-multi-conta-emissora.md`
**Objetivo:** a empresa opera com duas contas Cora — MC (configurada) e Cavalcante Viana
(pendente) — e o sistema assumia uma conta global. Introduzir "conta emissora" como atributo
do médico para que boleto, beneficiário, mensagens e conciliação saiam pela empresa correta.

## Decisões fechadas (dono, 2026-07-10)
- **D1-A:** conta emissora é atributo do médico (`medicos.conta_emissora`); backfill `mc`.
- **D2-A:** credenciais em env prefixadas (`CORA_MC_*` / `CORA_CV_*`) + registro estático de
  contas em código; `CORA_*` legadas viram fallback da MC (deploy sem env nova = status quo).
- **D3:** webhook com um secret por conta na mesma rota; reconsulta/cancelamento SEMPRE pela
  conta gravada no boleto (`boletos.conta_emissora`, desnormalização proposital).

## Pré-requisitos operacionais (gates externos — NÃO bloqueiam 7.1–7.3)
- **Assinatura Cora Pro na conta Cavalcante Viana** (~R$ 44,90/mês): a API de Integração
  Direta é habilitada por conta, e as credenciais (client_id + certificado) são gemas da
  conta/CNPJ — credencial da MC não emite pela CV. Decisão de custo do dono pendente;
  o sistema segue 100% MC até lá (fallback).
- Gerar credenciais mTLS da CV → configurar `CORA_CV_*` na Vercel.
- Registrar webhook na conta CV (secret próprio) e smoke test de baixo valor (arquitetura §8).
- Classificar os médicos da CV no cadastro (UI da 7.3 ou CSV).

## Stories

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 7.1 | Fundação multi-conta: migration + tipos + registro + env | migration 0021 | `shared` + `contas-emissoras.ts` + `env.ts` (fallback legado) + repositories |
| 7.2 | Gateway e rotas por conta emissora | 7.1 | `CoraGateway` parametrizado + factory + emitir/cancelar/webhook + remetente de e-mail |
| 7.3 | UI: empresa no cadastro, confirmação de emissão e recebíveis | 7.1 (7.2 p/ E2E) | MedicoForm + diálogo de emissão + badge/filtro em Recebíveis + CSV |

7.2 e 7.3 são paralelizáveis após 7.1.

## Fora de escopo
- Segmentação do dashboard por empresa (fase 2, arquitetura §6).
- Override de conta por emissão e 3ª conta/contas dinâmicas (sem caso de uso).
- Migração das env `CORA_*` legadas para `CORA_MC_*` na Vercel (opcional, por higiene).

---

# Épico 8 — Conciliação Bancária (extrato Cora + saldo por empresa)

**Fonte de verdade:** `docs/architecture/feature-conciliacao-bancaria.md`
**Discovery técnico:** `docs/research/2026-07-10-cora-apis-integracao-direta/`
**Objetivo:** trazer o caixa real para dentro do sistema — extrato por empresa (MC/CV) com
conciliação automática crédito↔boleto pago, fila de sugestões para casos ambíguos, tarifas
visíveis e saldo por conta no dashboard.

## Decisões fechadas (dono, 2026-07-10)
- **D1:** extrato SNAPSHOT no Supabase (`extrato_transacoes`) — conciliação exige estado.
- **D2:** matching conservador em camadas: auto SÓ com valor + CPF/CNPJ da contraparte +
  janela ±3 dias; ambiguidade → `sugerido` (revisão humana); tudo reversível com trilha.
- **D3:** sync sob demanda (botão por empresa) na v1, overlap de 3 dias; cron = fase 2.
- **D5:** saldo por conta no dashboard (cache 60s; degradação graciosa p/ CV).
- **D4 (Pix copia-e-cola) ADIADO** — "só se cobra por boleto mesmo"; desenho preservado na
  arquitetura §2-D4.

## Restrição técnica central
O extrato da Cora NÃO referencia o invoice_id do boleto (pesquisa §1) — o vínculo é
heurístico por natureza; a UX assume isso (fila de sugestões, nunca auto-conciliar ambíguo).

## Pré-requisitos operacionais
- Migration `0022_conciliacao_bancaria.sql` — dono roda manualmente no Supabase (padrão).
- Ambiente stage da Cora para testar o sync real (recomendado antes da 8.2; não bloqueia).

## Stories

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 8.1 | Fundação: migration 0022 + refactor `cora-http` + porta/gateways + repository | migration | `ContaBancariaPort` + `CoraContaGateway` + upsert idempotente |
| 8.2 | Sync do extrato + motor de conciliação + rotas | 8.1 | engine puro em camadas + sincronizar/conciliar/ignorar/desfazer |
| 8.3 | UI: página Extrato/Conciliação + saldo no dashboard | 8.2 | fila de sugestões + tarifas + cards MC/CV |

Sequência 8.1 → 8.2 → 8.3 (sem paralelismo — cada uma consome a anterior).

## Fora de escopo
- Pix copia-e-cola nas mensagens (adiado pelo dono).
- Plano de contas / DRE / categorização contábil; contas a PAGAR; NFS-e (épicos próprios).
- Cron de sync automático (fase 2) e conciliação N↔1/pagamento parcial.

---

# Épico 9 — DRE / Plano de Contas (categorização contábil)

**Status:** Em desenvolvimento — 9.1/9.2 Done (2026-07-11), 9.3 (UI) próxima.
**Fonte de verdade:** `docs/architecture/feature-dre-plano-contas.md`

**Objetivo:** transformar o caixa que já entra pelo Épico 8 (extrato + conciliação) em uma
Demonstração de Resultado (DRE) contábil formal — receitas, deduções, despesas por categoria
e resultado líquido —, incluindo despesas que não passam pela conta Cora.

## Decisões fechadas (dono, 2026-07-11)
1. **DRE formal**, não só um resumo de lucro/prejuízo: receita bruta, deduções da receita,
   despesas operacionais, despesas financeiras, resultado líquido.
2. **Categorização por regras + revisão manual** — mesmo padrão da fila de sugestões da
   conciliação (Épico 8): o sistema sugere a categoria (por contraparte/descrição/tipo já
   presentes no extrato) e o operador confirma ou corrige.
3. **Escopo consolidado + drill-down por empresa** (MC / Cavalcante Viana) — mesmo padrão do
   filtro de conta em `/extrato`.
4. **Duas fontes de dado:**
   - transações já sincronizadas do extrato Cora (Épico 8) — reaproveita
     `extrato_transacoes`, nada de recoletar;
   - **lançamentos manuais** para despesas fora da Cora (dinheiro, outro banco, cartão).
5. **Lançamentos manuais avulsos E recorrentes** (ex.: aluguel mensal se repete sozinho).
6. **Plano de contas — proposta inicial aceita como ponto de partida** (ajustável via
   cadastro, não fixo em código):
   ```
   RECEITAS
     Receita de honorários (boletos recebidos — já vem do Épico 8/conciliação)
   DEDUÇÕES DA RECEITA
     Tarifas bancárias (extrato, transaction_type = FEE)
     Impostos sobre serviços (ISS, se aplicável)
   DESPESAS OPERACIONAIS
     Despesas administrativas
     Despesas com pessoal
     Despesas com terceiros
   DESPESAS FINANCEIRAS
     Juros e outras taxas (fora tarifas bancárias)
   RESULTADO LÍQUIDO = Receitas − Deduções − Despesas
   ```

## Decisões de arquitetura (Aria @architect, 2026-07-11 — detalhe completo na fonte de verdade)
- **Granularidade: mês de caixa** (data da transação/lançamento), não competência — o DRE
  nasce do extrato bancário.
- **Motor próprio** `server/engine/categorizacao.ts` (mesmo padrão puro/testável do
  `conciliacao.ts`, mas independente dele): 2 auto-regras de sistema (crédito conciliado
  com boleto → Receita de honorários; débito FEE → Tarifas bancárias, ambas `confirmada`
  sem revisão) + regras do usuário por palavra-chave em contraparte/descrição (sempre
  `sugerida`, exige confirmação).
- **Plano de contas editável**: papel **admin** (mesmo padrão de `config-cobranca`).
  Categorizar transação, lançar manual e ver o relatório: **admin/financeiro** (mesmo
  padrão de `/extrato`/`/recebiveis`).
- **Recorrência sem cron**: lançamento recorrente é um template projetado NA LEITURA do
  relatório (sem cron/job novo); ajustar um mês isolado exige encerrar o template e lançar
  esse mês como avulso (limitação documentada, v1).

## Pré-requisitos operacionais
Nenhum novo — reaproveita 100% a infraestrutura do Épico 8 (extrato sincronizado por
conta). Migration `0023_dre_plano_contas.sql` (schema completo na fonte de verdade §4).

## Fora de escopo
- Contas a PAGAR como módulo completo (fornecedores, vencimentos, workflow de aprovação)
  — este épico cobre só o lançamento manual de despesa para efeito do DRE, não gestão de
  contas a pagar.
- NFS-e (épico próprio).
- Integração com contador/exportação para sistema contábil externo (SPED etc.).
- Exceção por mês em lançamento recorrente; recategorização retroativa automática ao
  cadastrar regra nova; gráficos/comparativo entre períodos (v1 é tabular).

## Stories propostas (@sm detalha após o GO)

| # | Story | Status | Depende de | Foco |
|---|-------|--------|-----------|------|
| 9.1 | Fundação: migration 0023 + seed + tipos shared + repositories básicos | **Done** (2026-07-11) | migration | schema (plano_contas, regras, lançamentos manuais, colunas em extrato_transacoes) |
| 9.2 | Motor de categorização + relatório do DRE + rotas | **Done** (2026-07-11) | 9.1 | `categorizacao.ts` + `relatorio-dre.ts` + 8 rotas (plano de contas/regras/categorizar/lançamentos/relatório) |
| 9.3 | UI: `/dre` (relatório) + `/dre/cadastro` (plano de contas/regras) + extensão do `/extrato` | Próxima | 9.2 | telas + testes de componente |

Sequência 9.1 → 9.2 → 9.3 (mesmo padrão sequencial do Épico 8).

## Próximo passo
Stories 9.1/9.2 fechadas (gates PASS, `docs/qa/gates/9.1-dre-fundacao.yml` e
`9.2-dre-motor-rotas.yml`), branches locais (`feat/9.1-dre-fundacao`,
`feat/9.2-dre-motor-rotas`) — aguardam push do @devops. Próxima: @sm rascunha a 9.3 (UI)
a partir da arquitetura §4/§7 — última story do Épico 9.

---

# Épico 10 — Correções do motor de cálculo (conferência da planilha da coordenação)

**Fonte:** conferência da planilha manual da coordenação vs. motor (2026-07-14) —
artifact do relatório + `memory/conferencia-calculo-guias.md`.
**Objetivo:** fechar as lacunas em que o motor calcularia o valor errado por não modelar regras
que a coordenação aplica na mão. A conferência **validou a base do motor** (faixas Hapvida,
mapeamento credenciado/não-credenciado, contagem, e a regra acima de 180 guias = teto + R$6/guia,
confirmada pelo dono); estas stories cobrem só o que sobrou.

## Definições do dono já fechadas (2026-07-14)
- **Acima de 180 guias (Hapvida):** teto + R$6/guia — o motor **já está correto**, nada a mudar
  (a planilha manual é que subcobrava ao capar no teto).
- **Preços de dez/2025 ~8% menores:** reajuste anual esperado, não é bug.

## Stories

| # | Story | Divergência | Status | Foco |
|---|-------|-------------|--------|------|
| 10.1 | Regras de preço próprias por médico/rubrica | D2 | **InReview** — implementado 2026-07-20, aguardando @qa (Nefrologia saiu para a 10.4) | override base+excedente+limiar / fixo no engine + cadastro (Jansen, Nelson, Carlos Batista, Jefferson) |
| 10.2 | Pediatria: consultas × valor unitário | D3 | **InReview** — implementado 2026-07-20, aguardando @qa | somar consultas ambulatoriais (produção separada na API) às guias, sem dupla contagem |
| 10.3 | Outros hospitais > 80 guias: cobrar o teto | D4 | **InReview** — implementado 2026-07-20, aguardando @qa | regra na tabela `precos` + revisão consciente do PRD §11 |
| 10.4 | Emissão por empresa (MEDISA) — **referência de arquitetura**, ver sub-stories abaixo | D2 (Nefrologia/guias cardíacas) | Split em sub-stories | novo agregado "empresa emissora" (reaproveita `RegraPreco`/`DadosCobranca`); complexidade revisada para L |
| 10.4a | Cadastro de empresas e vínculo médico↔empresa | D2 | **Done** — @qa PASS 2026-07-20 (1 achado corrigido na iteração) | tabela `empresas`, `medicos.empresa_grupo_id`, CRUD reaproveitando padrões de médico |
| 10.4b | Execução e resultado agregado por empresa | D2 | **Ready** — @po GO condicional 2026-07-20 (AC 3 ajustado: `base_excedente`/`fixo` na empresa viram alerta, não rateio chutado) — depende da 10.4a | extração de `aplicarRegraPreco`, `execucao_resultado_contribuicoes`, orquestrador |
| 10.4c | Emissão de boleto por empresa | D2 | **Ready** — @po GO 2026-07-20 — depende da 10.4b | branch na rota de emissão, UI de nova execução por empresa |

10.1–10.3 estão `InReview` (implementadas 2026-07-20, aguardando @qa). A 10.4 nasceu durante a GATE
da 10.1: Nefrologia/guias cardíacas não são override de médico, são produção de vários médicos
agrupada e faturada para a empresa MEDISA. O @architect concluiu o desenho em 2026-07-20 — reaproveita
`RegraPreco`/`DadosCobranca`/`ContaEmissora` já existentes, complexidade real é L (não XL) — e o @sm
quebrou o trabalho em 3 sub-stories sequenciais (10.4a → 10.4b → 10.4c). As três passaram pelo @po
(`*validate-story-draft`, GO) e estão `Ready` para @dev, respeitando a ordem de dependência (10.4a
primeiro — 10.4b e 10.4c dependem dela). D6 (conta emissora por médico varia por mês) é validação de
cadastro, não código — tratada fora do épico.

## Fora de escopo
- D1 (>180 guias) e D5 (reajuste dez/2025): resolvidos, sem trabalho.
- Ezequiel (por guia, instável) — resolvido dentro da própria 10.1: dono confirmou R$4,00/guia
  estável, reincluído no override automático (forma `por_guia`) no mesmo dia da GATE.
