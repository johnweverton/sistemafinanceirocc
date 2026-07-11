# Arquitetura — Conciliação Bancária (extrato Cora + Pix copia-e-cola + saldo por empresa)

**Autor:** Aria (@architect) · **Data:** 2026-07-10 · **Status:** Aprovado (dono, 2026-07-10 —
D1/D2/D3/D5 como propostos; **D4/Pix ADIADO**: "só se cobra por boleto mesmo")
**Discovery técnico:** `docs/research/2026-07-10-cora-apis-integracao-direta/` (pesquisa 2026-07-10)
**Pré-requisito já entregue:** multi-conta (Épico 7) — tudo aqui é POR CONTA (MC / Cavalcante Viana).

---

## 1. Problema e valor

Hoje o sistema enxerga só o que ELE emite (boletos e suas baixas). O caixa real das empresas
fica invisível: tarifas bancárias, recebimentos fora do sistema, transferências e o próprio
saldo. A conciliação fecha esse ciclo:

1. **Extrato dentro do sistema** — a coordenação para de alternar para o app da Cora.
2. **Conciliação automática** crédito↔boleto — confiança de que todo recebimento tem origem
   identificada; divergências viram fila de revisão, não surpresa no fim do mês.
3. **Tarifas visíveis** (`transaction_type=FEE`) — custo bancário por período/empresa.
4. **Saldo MC/CV no dashboard** — posição de caixa em tempo real.
5. **Pix copia-e-cola nas mensagens** — o médico paga na hora, sem abrir o PDF.

**Restrição central da API** (pesquisa §1): a entrada do extrato **não referencia o
invoice_id** do boleto — o vínculo é heurístico. A arquitetura abraça isso: matching em
camadas de confiança + fila de revisão humana (mesmo padrão do matching de médicos do Épico 5).

## 2. Decisões estruturais (opções e trade-offs)

### D1 — Persistir o extrato ou consultar ao vivo?

| Opção | Prós | Contras |
|-------|------|---------|
| **A (recomendada): snapshot no Supabase** (`extrato_transacoes`) | Conciliação exige ESTADO por transação (conciliado/ignorado/sugerido); histórico próprio independente da janela da API; página/dashboard leem do banco (sem cadeia mTLS por render); auditável | Tabela nova + rotina de sync |
| B: consulta live à API | Sem schema novo | Sem onde guardar o estado da conciliação — inviabiliza o objetivo; mTLS a cada acesso |

**Decisão proposta: A.** Sync idempotente por `(conta_emissora, entry_id)` UNIQUE.

### D2 — Motor de matching (camadas de confiança)

Determinístico, em camadas, executado após cada sync sobre pares "crédito não conciliado ×
boleto pago não conciliado" da MESMA conta:

| Camada | Regra | Resultado |
|--------|-------|-----------|
| 1 | valor idêntico (centavos) **+ documento da contraparte = `pagador_documento` do médico** + data ±3 dias da baixa | `conciliado_auto` |
| 2 | valor idêntico + data ±3 dias (sem documento ou documento divergente — pagamento por terceiro é comum) | `sugerido` (revisão humana) |
| 3 | sem par | `sem_match` |

- **Auto SÓ com documento batendo** — falso positivo em conciliação financeira é pior que
  trabalho manual; ambiguidade nunca concilia sozinha (2 candidatos na camada 1 → `sugerido`).
- Ações do operador: **confirmar** sugestão (`conciliado_manual`), **vincular manualmente**
  (escolher boleto), **ignorar** (transação sem relação com boletos: tarifa, transferência
  interna...), **desfazer** (tudo reversível; trilha de quem/quando).
- 1 boleto ↔ no máximo 1 transação conciliada (UNIQUE parcial em `boleto_id`).

### D3 — Sincronização: sob demanda (v1) vs automática

**Proposta: sob demanda na v1** — botão "Sincronizar extrato" por conta, janela do último
sync até hoje com **overlap de 3 dias** (reprocessa idempotente, pega lançamentos tardios).
Paginação `perPage=500`; volume esperado (~centenas/mês) cabe em uma chamada. Cron diário
(Vercel cron) fica como fase 2 — zero mudança de design, só um trigger a mais.
Guard: datas sempre `YYYY-MM-DD` (formato errado → 500 da Cora, documentado na pesquisa).

### D4 — Pix copia-e-cola nas mensagens — **ADIADO (decisão do dono, 2026-07-10)**

> "Deixe o pix copia e cola para depois, só se cobra por boleto mesmo." O desenho abaixo fica
> registrado para quando (se) a decisão mudar — nada dele entra no Épico 8.

O boleto registrado da Cora já nasce híbrido (boleto + Pix). O `pix.emv` (copia-e-cola) vem
na resposta da emissão, que **já persistimos** em `boletos.payload_resposta`.

- **Task de verificação primeiro:** conferir num payload real de produção se `pix.emv` está
  presente; se não estiver, incluir `payment_forms: ['BANK_SLIP','PIX']` no payload de
  emissão (aditivo) — a partir daí os novos boletos trazem o campo.
- WhatsApp: após o PDF, um `enviarTexto` com o copia-e-cola (mensagem separada — o médico
  copia com um toque; `ZappyGateway.enviarTexto` já existe).
- E-mail: bloco "Pague com Pix" no template existente.
- **Pré-requisito operacional:** chave Pix cadastrada na conta Cora (MC hoje; CV quando ativar).
- Degradação graciosa: sem `pix.emv` no payload → mensagens saem como hoje (só PDF).

### D5 — Saldo por empresa no dashboard

`GET /third-party/account/balance` por conta emissora. Rota interna com **cache curto em
memória (60s)** — dashboard não pode disparar cadeia mTLS a cada render. Card por empresa;
conta sem credenciais (CV pré-ativação) → card "não configurada", nunca erro.

## 3. Modelo de dados (shape — DDL detalhado com @data-engineer, migration 0022)

```
extrato_transacoes
 ├─ id uuid pk
 ├─ conta_emissora text NOT NULL CHECK in ('mc','cavalcante_viana')
 ├─ entry_id text NOT NULL            -- id da entrada na Cora
 │    UNIQUE (conta_emissora, entry_id)   -- idempotência do sync
 ├─ tipo text CHECK in ('CREDIT','DEBIT')
 ├─ transaction_type text             -- TRANSFER | PAYMENT | PIX | FEE (cru da API)
 ├─ valor numeric(12,2) NOT NULL      -- convertido de centavos na borda (mapper)
 ├─ descricao text
 ├─ contraparte_nome text
 ├─ contraparte_documento text        -- dígitos; chave da camada 1 do matching
 ├─ data_transacao timestamptz NOT NULL
 ├─ status_conciliacao text NOT NULL DEFAULT 'sem_match'
 │    CHECK in ('sem_match','sugerido','conciliado_auto','conciliado_manual','ignorado')
 ├─ boleto_id uuid NULL references boletos(id)
 │    UNIQUE parcial (boleto_id) WHERE status_conciliacao like 'conciliado%'
 ├─ conciliado_por uuid NULL references profiles(id)  -- null em conciliado_auto
 ├─ conciliado_em timestamptz NULL
 ├─ payload jsonb                     -- entrada crua da API (auditoria, padrão do projeto)
 └─ sincronizado_em timestamptz NOT NULL DEFAULT now()

extrato_syncs (log de sincronizações)
 ├─ id, conta_emissora, periodo_inicio, periodo_fim, qtd_novas, qtd_atualizadas
 └─ executado_por uuid references profiles(id), executado_em timestamptz
```

RLS espelhando `boletos` (0004): leitura admin/financeiro; escrita só service role.
Índices: `(conta_emissora, data_transacao)`, `(status_conciliacao)`, parcial em `boleto_id`.

## 4. Código (mapa arquivo → mudança)

| Arquivo | Mudança |
|---------|---------|
| `packages/shared` | `ContaBancariaPort { consultarExtrato(filtros), consultarSaldo() }`, tipos `ExtratoTransacao`, `StatusConciliacao`, `SaldoConta` |
| `server/gateway/cora-http.ts` **(novo, refactor REUSE)** | Extrai de `cora-gateway.ts` o miolo comum: agent mTLS + `obterToken` (cache) + `fetchMtls` — `CoraGateway` e o novo gateway consomem o MESMO client (uma instância por conta, tokens isolados como hoje) |
| `server/gateway/cora-conta-gateway.ts` **(novo)** | Implementa `ContaBancariaPort` (`GET /bank-statement/statement` paginado + `GET /third-party/account/balance`) |
| `server/gateway/mock-conta-gateway.ts` **(novo)** | Dev/testes (extrato sintético determinístico) |
| Factory | `criarContaGateway(conta)` — mesmo padrão/erros da `criarBoletoGateway` |
| `server/engine/conciliacao.ts` **(novo)** | Matching puro (camadas D2) — função sem I/O, testável como `precos.ts` |
| `server/repositories/extrato-repository.ts` **(novo)** | upsert idempotente do sync, listagem filtrada, transições de status |
| Rotas | `POST /api/extrato/sincronizar` (admin/financeiro, `maxDuration` folgado), `GET /api/extrato`, `POST /api/extrato/[id]/conciliar` \| `/ignorar` \| `/desfazer` |
| UI | Página **/extrato** (filtros conta/período/status/tipo, badges, fila de sugestões, ações, card de tarifas) + cards de saldo no `/dashboard` |
| Mensagens (D4) | `emitir/route.ts` + `reenviar_boleto/route.ts`: extrair `pix.emv` do payload → `enviarTexto` (WhatsApp) + bloco no e-mail |

## 5. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Falso positivo do matching automático | Auto exige documento idêntico + valor + janela; ambiguidade → `sugerido`; tudo reversível com trilha |
| Sync estourar `maxDuration` na Vercel | Paginação 500/página + janela limitada por sync; volume atual é pequeno; padrão de lotes do Épico 5 como plano B |
| Divergência de fuso na janela de datas | Janela com overlap de 3 dias + datas `YYYY-MM-DD` validadas por Zod (formato errado = 500 na Cora) |
| CV sem credenciais | Degradação por conta (mesmo padrão 503 `CONTA_NAO_CONFIGURADA` da 7.2/7.3); MC nunca é afetada |
| `pix.emv` ausente nos payloads antigos | D4 tem task de verificação; feature degrada para o comportamento atual (só PDF) |
| Rate limit desconhecido do extrato | Sync manual v1 (baixa frequência); cache de 60s no saldo |

## 6. Épico 8 — quebra proposta (@sm detalha após o GO)

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 8.1 | Fundação: migration 0022 + refactor `cora-http` + porta/gateways + repository | migration | shared + gateways + upsert idempotente |
| 8.2 | Sync + engine de conciliação + rotas | 8.1 | matching em camadas + ações conciliar/ignorar/desfazer |
| 8.3 | UI: página Extrato/Conciliação + saldo no dashboard | 8.2 | fila de sugestões + tarifas + cards MC/CV |

Sequência 8.1→8.2→8.3. (A antiga 8.4/Pix foi adiada — decisão do dono.)

## 7. Fora de escopo (explícito)

- **Pix copia-e-cola nas mensagens** (D4 adiado — dono, 2026-07-10: cobrança só por boleto).
- Plano de contas / DRE / categorização contábil (discovery próprio com a coordenação).
- Contas a PAGAR via API (dinheiro saindo — exige controles próprios; só com demanda clara).
- NFS-e automática (épico próprio; aguarda respostas do dono sobre certificado A1/prefeitura).
- Cron de sync automático (fase 2 — design já suporta).
- Conciliação multi-transação (N transações ↔ 1 boleto, pagamentos parciais) — v1 é 1↔1;
  parcial hoje já não existe no domínio (boleto é pago integral).

## 8. Pendências externas / operacionais

- **Ambiente stage da Cora** (nunca usado): configurar credenciais de stage para testar o
  sync de extrato sem produção — recomendado antes da 8.2 (não bloqueia a 8.1).

## 9. Decisões do dono (registradas 2026-07-10)

1. **D1/D2/D3/D5 aprovados** como propostos (snapshot + matching conservador + sync manual
   v1 + saldo no dashboard).
2. **D4 (Pix copia-e-cola) ADIADO** — "só se cobra por boleto mesmo". O desenho fica no §2-D4
   para retomada futura; pergunta da chave Pix fica sem efeito até lá.
