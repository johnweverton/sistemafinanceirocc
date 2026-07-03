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
