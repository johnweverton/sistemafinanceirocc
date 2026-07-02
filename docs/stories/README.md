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
