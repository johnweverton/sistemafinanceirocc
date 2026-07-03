# Arquitetura — Ciclo Financeiro (baixa por webhook + Contas a Receber + Dashboard)

**Autor:** Aria (@architect) · **Data:** 2026-07-02 · **Status:** Proposto
**Contexto:** fecha o ciclo **emite → recebe → enxerga**. Continua o Épico 3 (dados de cobrança +
emissão Cora, já entregue). Fonte relacionada: `docs/architecture/feature-dados-cobranca-boleto.md`.

---

## 1. Problema e objetivo

Hoje o sistema **emite** boletos (Fase 3, desligada por flag) e registra em `boletos`
(status apenas `emitido`|`falha`, guardando `id_externo` = invoice id da Cora). Falta a outra
metade do ciclo: saber **quando o boleto foi pago**, expor **contas a receber** e **enxergar**
inadimplência. Sem isso, a conciliação continua manual.

O Cora **envia webhook automaticamente** quando o boleto é pago/compensado (ativado por
`client_id` após a 1ª emissão), com noção de idempotência. Vamos consumir esse webhook para dar
**baixa** e derivar a visão financeira.

> A emissão segue **DESLIGADA** (`GATEWAY_EMISSAO_HABILITADA=false`). Este ciclo é construído
> pronto; só é exercitado de verdade quando a emissão for ligada em produção.

---

## 2. Decisões fechadas (2026-07-02)

1. **Confiança no webhook:** token secreto no path **+ reconsulta na API da Cora** (mTLS). O
   corpo do webhook é só um gatilho; o **status real vem da reconsulta** (`GET /invoices/{id}`).
   Não confiamos no payload (a assinatura HMAC do Cora não é pública/estável).
2. **Vencido/inadimplência:** **derivado on-read** — `vencido` = `vencimento < hoje` e sem baixa.
   Sem job agendado, sem `pg_cron`. Status materializados: `emitido`/`falha`/`pago`/`cancelado`.
3. **Faseamento:** **Sub-épico A** (webhook + baixa + Contas a Receber) primeiro; **Sub-épico B**
   (Dashboard) em cima dos dados já reconciliados.

---

## 3. Fluxo (Sub-épico A)

```
Cora (boleto pago) ──POST──▶ /api/webhooks/cora/{secret}
                                    │ 1. valida secret (constant-time)
                                    │ 2. idempotência (boleto_eventos.evento_id UNIQUE)
                                    │ 3. RECONSULTA invoice na Cora (mTLS) ── fonte da verdade
                                    │ 4. mapeia status real → baixa no boleto
                                    ▼
                              boletos (pago_em, valor_pago, status) ──▶ Contas a Receber (derivado)
```

Sempre responde **200** (mesmo para evento não-casado) para evitar tempestade de retries do Cora;
eventos órfãos ficam logados em `boleto_eventos` para investigação.

---

## 4. Modelo de dados (shape — DDL detalhado com @data-engineer)

Nova migration `0007_ciclo_financeiro.sql`:

### 4.1 `boletos` — colunas de baixa (todas nullable/aditivas)
| Coluna | Tipo | Regra |
|--------|------|-------|
| `vencimento` | date | data de vencimento enviada ao Cora (necessária p/ derivar `vencido` e aging) |
| `pago_em` | timestamptz | preenchido na baixa |
| `valor_pago` | numeric(10,2) | valor efetivamente pago (suporta parcial/divergente) |
| `atualizado_em` | timestamptz | default now(); toca a cada baixa |

E o CHECK de `status` passa a aceitar: `emitido`, `falha`, `pago`, `cancelado`
(**`vencido` NÃO é armazenado** — é derivado on-read).

> **Impacto na emissão:** `vencimento` precisa ser **persistido no momento da emissão** (hoje é
> calculado no `cora-gateway` mas não gravado). Pequeno ajuste em `criarBoleto` + na rota de
> emissão para passar a data resolvida. Registrar no story.

### 4.2 `boleto_eventos` — auditoria de webhook + idempotência
| Coluna | Tipo | Regra |
|--------|------|-------|
| `id` | uuid PK | |
| `boleto_id` | uuid FK boletos(id) nullable | null se evento não casou |
| `id_externo` | text | invoice id recebido no evento |
| `evento_id` | text **UNIQUE** | id/idempotency-key do evento Cora → dedupe |
| `evento_tipo` | text | ex.: `invoice.paid`, `invoice.canceled` |
| `status_reconsultado` | text | status confirmado via reconsulta |
| `payload` | jsonb | corpo cru (auditoria) |
| `recebido_em` | timestamptz | default now() |

Índices: `boletos(vencimento)`, `boletos(status)`, `boleto_eventos(id_externo)`. RLS: leitura
admin/financeiro (espelha `boletos`); escrita só via service role.

---

## 5. Backend (Sub-épico A)

### 5.1 Extensão do gateway (porta/adapter)
`BoletoGatewayPort` ganha `consultarInvoice(idExterno): Promise<StatusInvoice>` onde
`StatusInvoice = { status: 'paid'|'canceled'|'open'|'overdue'|..., valorPago: number|null, pagoEm: string|null }`.
- `CoraGateway.consultarInvoice`: `GET /invoices/{id}` via mTLS (reusa `obterToken` + `fetchMtls`).
- `MockGateway.consultarInvoice`: retorno configurável para testes.

### 5.2 Rota de webhook — `POST /api/webhooks/cora/[secret]`
- **Pública** (sem sessão). **Adicionar `api/webhooks` à exclusão do matcher** em `middleware.ts`
  (hoje exclui `api/health`). Segurança **não** vem da sessão, e sim de: secret no path
  (constant-time vs `CORA_WEBHOOK_SECRET`) **+ reconsulta** como fonte da verdade.
- Passos: valida secret → grava `boleto_eventos` (`on conflict evento_id do nothing`; se já existe,
  200 imediato) → `consultarInvoice(id_externo)` → mapeia → atualiza `boletos` (por `id_externo`) →
  200. Evento órfão (sem boleto): loga e 200.
- Nunca usa valores do corpo para a baixa — usa os da reconsulta.

### 5.3 Repositório
- `boleto-repository`: `registrarBaixa(idExterno, {status, pagoEm, valorPago})`,
  `registrarEvento(...)` (idempotente), e leitura para recebíveis.
- **Contas a Receber**: RPC/view `vw_recebiveis` (ou função) que junta `boletos` +
  `execucao_resultados` (médico, competência, valor) e calcula o **status derivado**:
  `pago` (pago_em) · `cancelado` · `vencido` (`vencimento < current_date` e sem baixa) · `em_aberto`.

### 5.4 Env / config
- `CORA_WEBHOOK_SECRET` (novo). Registro da URL de webhook no Cora é **ação de @devops/negócio**
  quando a emissão for ligada (pré-requisito externo).

---

## 6. Sub-épico B — Dashboard financeiro

Agregações **server-side** (RPC/views — @data-engineer), consumidas por `/dashboard`:
- **Por competência:** emitido, recebido, em aberto, vencido, **taxa de inadimplência**.
- **Por médico:** idem + ticket médio.
- **Aging** de vencidos: faixas 0–30 / 31–60 / 60+ dias.

UI reusa o design system atual (cards, tabular mono, badges); refino fino com @ux-design-expert.
Sem novas tabelas — lê dos dados já reconciliados no Sub-épico A.

---

## 7. Segurança (defesa em profundidade)
- Webhook: **secret no path** (constant-time) + **reconsulta** (fonte da verdade) + **idempotência**
  (`evento_id UNIQUE`) + escrita só service role. Nunca confiar em valores do payload.
- Sempre 200 para o Cora (evita retries); erros internos logados, não propagados ao emissor.
- RLS inalterado (leitura admin/financeiro). Sem nova PII.
- Middleware: exceção explícita e documentada para `api/webhooks` (como `api/health`).

---

## 8. NFR
- **Performance:** reconsulta = 1 chamada mTLS por evento (baixo volume — ~120 boletos/mês).
  Recebíveis/dashboard via RPC/view indexada (`vencimento`, `status`).
- **Confiabilidade:** idempotência absorve reentrega; reconsulta corrige divergência de payload.
- **Observabilidade:** `boleto_eventos` guarda todo evento (inclusive órfão) para auditoria.

---

## 9. Faseamento e stories sugeridas

**Sub-épico A — Baixa + Contas a Receber** (entrega o fechamento do ciclo de dados)
- A1: migration 0007 (colunas de baixa em `boletos` + `boleto_eventos` + RLS/índices) — @data-engineer.
- A2: `consultarInvoice` no gateway (Cora mTLS + mock) + persistir `vencimento` na emissão.
- A3: rota `POST /api/webhooks/cora/[secret]` + exceção no middleware + idempotência + reconsulta + baixa.
- A4: Contas a Receber — RPC/view `vw_recebiveis` + página `/recebiveis` (filtros competência/médico/status).

**Sub-épico B — Dashboard** (em cima de A)
- B1: RPC/views de agregação (competência, médico, aging) — @data-engineer.
- B2: página `/dashboard` (KPIs + aging) — UI.

---

## 10. Decisões em aberto (para o dono/negócio)
1. **Baixa parcial:** o Cora permite pagamento parcial de boleto? Se sim, `valor_pago < valor`
   deve virar status próprio (`pago_parcial`) ou alerta? (Modelamos `valor_pago` para suportar;
   a regra de negócio confirma o tratamento.)
2. **Cancelamento:** haverá cancelamento de boleto (via Cora/manual)? Já prevemos `cancelado`.
3. **KPIs do dashboard:** o conjunto do §6 cobre o essencial — confirmar se falta algo (ex.: por
   colaborador responsável).

---

## 11. Handoff
- **@data-engineer (Dara):** migration 0007 (A1) + RPC/views de recebíveis e dashboard (A4/B1).
- **@sm (River):** quebrar Sub-épico A (A1–A4) e B (B1–B2) em stories.
- **@dev (Dex):** implementar por story.
- **@devops (Gage):** registrar a URL de webhook no Cora + `CORA_WEBHOOK_SECRET` (quando ligar a emissão).
- **@pm (Morgan):** decisões §10 com o cliente.

Sources:
- [Cora API — developers](https://developers.cora.com.br/)
- [Cora — integração via API (webhooks de pagamento)](https://www.cora.com.br/blog/integracao-direta-cora/)
- [Boas práticas de webhook de pagamento](https://apidog.com/pt/blog/payment-webhook-best-practices-pt/)
