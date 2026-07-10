# Relatório — APIs da Cora (Integração Direta)

**Fontes primárias:** developers.cora.com.br (docs + reference), cora.com.br (planos/termos).
Base stage: `https://api.stage.cora.com.br` · Produção: `https://matls-clients.api.cora.com.br`
(token) — mesma autenticação que já usamos (OAuth2 client_credentials + mTLS, token de 24h,
scope único `offline_access` = acesso a todos os recursos).

---

## 1. Extrato / Conciliação bancária ⭐ (interesse do dono)

**`GET /bank-statement/statement`** — créditos e débitos da conta.

| Param | Descrição |
|-------|-----------|
| `start`, `end` | `YYYY-MM-DD` (formato errado → **500**, pegadinha documentada) |
| `type` | `CREDIT` \| `DEBIT` |
| `transaction_type` | `TRANSFER` \| `PAYMENT` \| `PIX` \| `FEE` |
| `page`, `perPage` | paginação (perPage máx. 500) |
| `aggr` | inclui totais agregados (creditTotal/debitTotal) |

Resposta: saldo inicial/final do período + `entries[]` com `id`, `type`, `amount` (centavos),
`createdAt`, `transaction {id, type, description, counterParty {name, identity}}`.

**Limitação central:** a entrada do extrato **não referencia o `invoice_id`** do boleto. A
conciliação boleto↔extrato é por **heurística**: valor + data de liquidação + contraparte
(CPF/CNPJ do pagador — que temos em `medicos.pagador_documento`). O caminho complementar
oficial é o detalhe da invoice (`GET /v2/invoices/{id}`), que traz `payments[]` (id, amount,
payment_date) — nossa fonte de verdade de baixa já usa isso.

**O que o extrato agrega que hoje não temos:** tarifas (`FEE`), recebimentos fora do sistema,
transferências e saídas — visão completa do caixa, não só dos boletos que emitimos.

## 2. Saldo e dados de conta

- **`GET /third-party/account/balance`** — saldo em tempo real.
- **`GET /third-party/account/`** — agência/conta/banco.

Com o multi-conta do Épico 7, dá para mostrar **caixa da MC e da CV lado a lado** no dashboard
(cada uma com suas credenciais).

## 3. Contas a pagar (Payments)

Grupo completo: iniciar pagamento de **boleto de terceiro** (código de barras + data),
**agendar**, listar histórico, cancelar iniciado, e guias **DARF** e **GPS**. É o outro lado do
ciclo financeiro (hoje o sistema só cobre contas a RECEBER).

## 4. NFS-e (nota fiscal de serviço) ⭐ potencial alto para contabilidade

Fluxo: **`POST /fiscal-receipts/credentials`** (upload do certificado **A1 e-CNPJ `.pem`** +
senha; algumas prefeituras exigem login/senha municipal) → **`POST
/fiscal-receipts/service-receipt`** vinculando a nota a uma **cobrança existente** (`receivable
{id, type: INVOICE}`), com config de ISS.

- Status: `WAITING_CERTIFICATE` → `WAITING_TRIGGER` (**emite automaticamente quando a cobrança
  for PAGA**) → `COMPLETED` | `ERROR`.
- **1 nota por cobrança** (tentativas subsequentes dão erro).
- Webhook próprio: resource `service receipt`, triggers `issued/cancelled/cancel_error/error`.
- Custo ~R$ 0,49/nota (site Cora Pro).

Encaixe perfeito no nosso fluxo: emitimos o boleto → registramos a NFS-e em `WAITING_TRIGGER`
→ médico paga → nota sai sozinha.

## 5. Pix

- **Não há API de cobrança Pix avulsa nem de transferência Pix** documentada.
- O Pix vive **dentro da invoice**: `payment_forms: ['PIX']` (ou boleto+Pix híbrido) →
  resposta traz `pix.emv` (copia-e-cola) + QR. Pré-requisito: **chave Pix cadastrada** na
  conta (via app, não há API de chaves).
- Mínimo R$ 5,00 (mesma regra que já conhecemos).

Nosso payload atual não envia `payment_forms` — o boleto registrado da Cora já sai híbrido por
padrão, mas **não expomos o copia-e-cola Pix** nas mensagens ao médico (só o PDF).

## 6. Webhooks — catálogo completo de resources/triggers

| Resource | Triggers |
|----------|----------|
| `invoice` | `drafted`, `created`, `paid`, `canceled`, `overdue`, `*` |
| `transfer` | `refunded`, `canceled`, `completed`, `*` |
| `payment` | `initiated`, `created`, `completed`, `error`, `reproved`, `approved`, `*` |
| `register` | `completed` |
| `service receipt` (NFS-e) | `issued`, `cancelled`, `cancel_error`, `error` |

**🔥 Achado crítico para o NOSSO sistema:** o exemplo oficial do POST de notificação mostra
`content-length: 0` e os dados do evento nos **headers**:

```
webhook-event-id: evt_lEhFeN5OQ90y4mIN1aj399CA
webhook-event-type: invoice.paid
webhook-resource-id: inv_zXmtr2n0RpmIwdjfnNokhA
user-agent: Cora-Webhook
content-length: 0
```

Isso explica os **2 webhooks "vazios"** recebidos em produção (2026-07-10): nossa rota
(`extrairEvento`) só lê o **corpo**. Com body vazio, perdemos `idExterno` e o evento vira
`semIdExterno` — a baixa só aconteceu porque reconsultamos por outros caminhos. Há um parâmetro
`includeResource` no endpoint (provável opt-in para receber o recurso no corpo), mas o contrato
seguro é **ler os headers**. Resposta esperada do nosso lado: `{"success": true}`.

Lacunas da doc: política de retry (intervalos/backoff) e assinatura/HMAC de autenticidade não
documentadas — nosso secret no path continua sendo a defesa, + reconsulta como fonte de verdade.

## 7. `overdue` como trigger real

`invoice.overdue` **existe** como trigger. Hoje derivamos `vencido` on-read (decisão do Épico
4, correta). Um endpoint `overdue` permitiria disparar **régua de cobrança de atraso**
(lembrete automático por WhatsApp/e-mail no vencimento) sem cron.

## 8. Limitações e requisitos (devil's advocate)

- **Cora Pro obrigatório por conta** (R$ 44,90/mês) para Integração Direta — confirma a
  resposta dada ao dono sobre a CV.
- **Rate limit documentado:** 100 boletos/6min (transmissão a gateways); demais limites não
  publicados.
- **Token:** 24h (nosso cache atual está ok); certificado/autorização com validade de ~12
  meses — **renovação manual** (colocar lembrete operacional! emitido 2026-07-09 → renovar até
  ~2027-07).
- **Stage/sandbox existe** (`api.stage.cora.com.br`, credenciais próprias em Conta > API,
  saldo fictício) — nunca usamos; útil para testar extrato/NFS-e sem risco.
- **Suporte fraco** (e-mail, sem SLA; termos dizem explicitamente que suporte não é garantido)
  e proibição de sublicenciamento/revenda nos termos.
- Reclamação antiga de "não ter webhooks" está **desatualizada** (webhooks existem e usamos) —
  contradição entre fonte comunitária (MEDIUM) e doc oficial (HIGH); prevalece a oficial.

## Fontes

- https://developers.cora.com.br/reference/consulta-de-extrato
- https://developers.cora.com.br/reference/lista-de-endpoints
- https://developers.cora.com.br/reference/criação-de-endpoints
- https://developers.cora.com.br/reference/exemplo-de-post-da-notificação
- https://developers.cora.com.br/reference/upload-certificado-a1-e-credenciais-nfse
- https://developers.cora.com.br/reference/emissão-nota-fiscal-servico
- https://developers.cora.com.br/reference/qr-code-pix-v2
- https://developers.cora.com.br/reference/saldo-de-conta · /reference/dados-de-conta
- https://developers.cora.com.br/docs/integracao-direta · /docs/client-credentials-int-direta
- https://www.cora.com.br/termos-e-condicoes-de-apis/ · /conta-pj/cora-pro/
- Comunidade (MEDIUM): ReclameAqui (suporte), github.com/OpenSourceCommunityBrasil/RscApiCora
