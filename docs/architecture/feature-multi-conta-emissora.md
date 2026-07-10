# Arquitetura — Multi-Conta Emissora (MC + Cavalcante Viana)

**Autor:** Aria (@architect) · **Data:** 2026-07-10 · **Status:** Proposto (aguardando validação do dono)
**Contexto:** a empresa opera com **duas contas Cora** — **MC** (já configurada e validada em
produção) e **Cavalcante Viana** (ainda não configurada). O sistema foi desenhado assumindo
**uma única conta emissora global**, e essa premissa está espalhada por 7 pontos do sistema.

---

## 1. Problema

Todo boleto hoje sai da conta configurada nas env vars `CORA_*` (a MC). Não existe o conceito
de "conta emissora" em lugar nenhum do domínio. A premissa mono-conta aparece em:

| # | Ponto | Arquivo | Premissa mono-conta |
|---|-------|---------|---------------------|
| 1 | Env | `apps/web/src/lib/env.ts:46-54` | Um único conjunto `CORA_CERT_BASE64/KEY/API_URL/CLIENT_ID/WEBHOOK_SECRET` |
| 2 | Gateway | `apps/web/src/server/gateway/cora-gateway.ts:164-181` | Construtor lê as env globais; um agent mTLS, um token cache |
| 3 | Factory | `apps/web/src/server/gateway/boleto-gateway-factory.ts:13` | `criarBoletoGateway()` sem parâmetro de conta |
| 4 | Emissão | `apps/web/src/app/api/boletos/emitir/route.ts:162` | Emite sempre pela conta global |
| 5 | Cancelamento | `apps/web/src/app/api/boletos/[id]/cancelar/route.ts` | Cancela sempre pela conta global |
| 6 | Webhook | `apps/web/src/app/api/webhooks/cora/[secret]/route.ts:59,98` | Um secret; reconsulta (`consultarInvoice`) sempre pela conta global |
| 7 | Dados | `boletos` (0004), `medicos` (0001/0006), `vw_recebiveis` (0008) | Nenhuma coluna registra por qual conta o boleto foi emitido |

**Consequência de não resolver:** boletos da Cavalcante Viana não podem ser emitidos; e se as
credenciais fossem simplesmente trocadas por médico "na mão", cancelamento e conciliação
(webhook reconsulta a invoice) quebrariam — a invoice de uma conta não existe na outra.

**Impacto na experiência do cliente (médico pagador):** o beneficiário impresso no boleto é a
conta que emitiu. Médico que tem relação com a Cavalcante Viana recebendo boleto da MC (ou
vice-versa) gera estranhamento, contestação e não-pagamento. A conta emissora é parte da
identidade da cobrança, não um detalhe de infraestrutura.

---

## 2. Decisões estruturais (opções e trade-offs)

### D1 — Onde nasce a decisão "qual conta emite este boleto?"

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (recomendada)** | **Atributo do médico** — `medicos.conta_emissora`, definido no cadastro | Consistência mês a mês (o médico sempre recebe da mesma empresa); zero fricção na emissão; espelha o padrão já existente de parametrização por médico (condições comerciais, modo de cobrança) | Exige classificar a base de médicos uma vez |
| B | Escolha manual a cada emissão (dropdown no dialog) | Flexibilidade total | Erro humano recorrente; decisão repetida ~120×/mês; inconsistência entre competências do mesmo médico |
| C | Híbrido: default por médico + override na emissão | Cobre exceções | Complexidade de UI e auditoria sem caso de uso conhecido hoje |

**Decisão proposta: A.** A relação médico↔empresa é estável (é uma relação contratual). Se um
dia houver exceção pontual, evoluir A→C é aditivo. **Backfill:** todos os médicos existentes
recebem `'mc'` (preserva 100% o comportamento atual — Gold Standard Baseline).

### D2 — Onde vivem as credenciais das contas

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (recomendada)** | **Env vars prefixadas por conta** (`CORA_MC_*`, `CORA_CV_*`) + registro estático de contas em código (`contas-emissoras.ts`) | Secrets nunca no banco (padrão atual do projeto); rotação via Vercel sem deploy de dados; validação Zod centralizada em `env.ts` | Adicionar 3ª conta exige entrada no registro + envs (deploy) |
| B | Tabela `contas_emissoras` com credenciais no Postgres | Contas dinâmicas via UI | Certificado mTLS + chave privada no banco = superfície de vazamento inaceitável; RLS não protege de service role; contraria o hardening já feito |
| C | Tabela para metadados + env para secrets | Metadados editáveis | Duas fontes de verdade para 2 contas fixas; complexidade sem ganho real |

**Decisão proposta: A.** São 2 contas, estáveis, de uma única empresa-cliente. O registro em
código é o "YAML" desta config (nada mutável hardcoded — tudo que muda entre ambientes fica
em env):

```ts
// apps/web/src/server/gateway/contas-emissoras.ts (novo)
export const CONTAS_EMISSORAS = {
  mc: {
    slug: 'mc',
    nomeExibicao: 'MC',                    // rótulos de UI e mensagens
    envPrefix: 'CORA_MC',                  // CORA_MC_CERT_BASE64, CORA_MC_KEY_BASE64, ...
  },
  cavalcante_viana: {
    slug: 'cavalcante_viana',
    nomeExibicao: 'Cavalcante Viana',
    envPrefix: 'CORA_CV',
  },
} as const;
export type ContaEmissora = keyof typeof CONTAS_EMISSORAS;
```

**Compatibilidade:** as env vars legadas `CORA_*` (sem prefixo) passam a ser **fallback da
conta `mc`**. Deploy do código novo sem nenhuma env nova = comportamento idêntico ao atual.

### D3 — Webhook: como autenticar e como reconsultar

- **Autenticação:** um **secret por conta** (`CORA_MC_WEBHOOK_SECRET`, `CORA_CV_WEBHOOK_SECRET`),
  mesma rota `/api/webhooks/cora/[secret]`. O secret recebido é comparado (tempo constante)
  contra os dois; registra-se um webhook **em cada conta Cora**, cada um com seu secret.
  (O da MC já existe: `end_4SMqqHZ7NopT6Eh9qnDnbn` — permanece válido com o secret legado.)
- **Reconsulta (fonte da verdade):** a conta usada em `consultarInvoice` **NÃO** vem do secret,
  e sim de `boletos.conta_emissora` do boleto localizado por `id_externo`. É a informação
  persistida e auditável — imune a webhook entregue "na conta errada".
- Evento sem boleto correspondente: mantém o comportamento atual (loga em `boleto_eventos`,
  responde 200, nada a conciliar).

---

## 3. Modelo de dados (shape — DDL detalhado com @data-engineer)

Migration `0021_conta_emissora.sql`, **tudo aditivo e idempotente** (zero downtime):

| Mudança | Regra |
|---------|-------|
| `medicos.conta_emissora text not null default 'mc'` | CHECK `in ('mc','cavalcante_viana')`; backfill implícito pelo default |
| `boletos.conta_emissora text not null default 'mc'` | mesmo CHECK; registra por qual conta o boleto **foi de fato emitido** (auditoria e operações posteriores) |
| `medicos_historico` | alteração de `conta_emissora` entra no histórico como qualquer campo (mecanismo existente já cobre) |
| `vw_recebiveis` | `create or replace` adicionando `b.conta_emissora` (aditivo; view já é replace-safe) |

Nota de domínio: `boletos.conta_emissora` é **desnormalização proposital** — se o médico
mudar de empresa no futuro, os boletos antigos continuam apontando para a conta que os emitiu
(cancelamento e conciliação corretos para boletos em aberto).

---

## 4. Mudanças de código (mapa arquivo → mudança)

| Arquivo | Mudança |
|---------|---------|
| `lib/env.ts` | Adicionar `CORA_MC_*` e `CORA_CV_*` (todas opcionais no schema); helper `getCredenciaisConta(conta)` que resolve prefixo → credenciais, com fallback das `CORA_*` legadas para `mc` |
| `server/gateway/contas-emissoras.ts` **(novo)** | Registro das contas (slug, nome de exibição, prefixo de env) |
| `server/gateway/cora-gateway.ts` | Construtor passa a receber `{ certBase64, keyBase64, apiUrl, clientId }` em vez de ler env global. Agent mTLS e cache de token ficam **por instância = por conta** (comportamento atual preservado) |
| `server/gateway/boleto-gateway-factory.ts` | `criarBoletoGateway(conta: ContaEmissora)` — assinatura ganha o parâmetro; mock ignora a conta |
| `api/boletos/emitir/route.ts` | Resolve `conta = medico.contaEmissora`; passa à factory; persiste em `boletos.conta_emissora`; resposta inclui a conta |
| `api/boletos/[id]/cancelar/route.ts` | Usa `boleto.conta_emissora` (nunca a do médico — ver nota §3) |
| `api/webhooks/cora/[secret]/route.ts` | Autentica contra os secrets das duas contas; reconsulta pela conta do boleto |
| `server/repositories/boleto-repository.ts` + `medico-repository.ts` + mappers | Ler/gravar o novo campo |
| `packages/shared` (types) | `ContaEmissora` no domínio; `Boleto.contaEmissora`; `Medico.contaEmissora` |
| `server/gateway/email-gateway.ts:76` | `from: "Carmem Contabilidade"` **hardcoded** → nome de exibição da conta emissora (violação de Config > Hardcoding já existente; corrigir junto) |

---

## 5. Experiência do cliente (médico pagador) — requisitos de UX

1. **Beneficiário correto no boleto** (automático ao emitir pela conta certa): o médico
   reconhece a cobrança da empresa com quem tem contrato. É o requisito central.
2. **Mensagens coerentes com o beneficiário:** o e-mail que entrega o boleto deve sair com
   remetente/assinatura da empresa emissora (`nomeExibicao` do registro), não um nome fixo.
   Mesmo racional para o texto do WhatsApp, se/quando houver texto além do PDF.
3. **Consistência temporal:** conta fixa por médico (D1-A) garante que o médico recebe da
   mesma empresa todo mês — nada de alternância que gere dúvida.

## 6. Experiência interna (equipe financeiro)

| Superfície | Mudança |
|-----------|---------|
| Cadastro do médico | Campo **"Empresa emissora"** (select MC / Cavalcante Viana). Obrigatório no form para novos médicos; existentes já vêm com MC do backfill |
| Confirmação de emissão (`RelatorioGrupos` → dialog) | Exibir por qual empresa o boleto sairá — última barreira contra emissão pela conta errada |
| Recebíveis | Badge/coluna "Empresa" (via `vw_recebiveis.conta_emissora`) + filtro por conta |
| Dashboard | Segmentação por conta emissora — **fase 2, opcional** (agregações atuais continuam corretas: são da empresa-cliente como um todo) |

---

## 7. Plano de testes (safety net)

1. **Factory:** `criarBoletoGateway('mc')` vs `('cavalcante_viana')` usam credenciais distintas;
   sem env da conta pedida → erro claro nomeando a conta e as vars faltantes.
2. **Fallback legado:** só `CORA_*` configurado → conta `mc` funciona (regressão zero).
3. **Emissão:** boleto gravado com `conta_emissora` do médico; médico CV emite pela CV.
4. **Cancelamento:** usa a conta do **boleto**, mesmo se o médico tiver trocado de empresa.
5. **Webhook:** secret da CV autentica; secret inválido → 401; reconsulta usa a conta do boleto
   (mock espião por conta); idempotência inalterada.
6. **Testes existentes** de emissão/cancelamento/webhook continuam verdes sem env nova (baseline).

## 8. Rollout (ordem de deploy segura)

1. **Migration 0021** (aditiva; nada muda em runtime).
2. **Deploy do código** com fallback legado — sistema segue 100% MC, zero downtime.
3. **Pendência externa:** obter da Cora o **certificado mTLS + client_id da conta Cavalcante
   Viana** (mesmo processo já feito para a MC) → configurar `CORA_CV_*` na Vercel.
4. **Registrar o webhook na conta CV** (com `CORA_CV_WEBHOOK_SECRET` próprio), como feito para
   a MC. Validar token 200 antes de prosseguir.
5. **Classificar os médicos** da Cavalcante Viana no cadastro (UI).
6. **Smoke test:** emissão real de baixo valor pela CV → conferir beneficiário, PDF, webhook de
   baixa e cancelamento.

## 9. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Boleto emitido pela conta errada | Campo obrigatório no cadastro + conta exibida no dialog de confirmação + backfill conservador (`mc` = status quo) |
| Cancelamento/reconsulta na conta errada após médico trocar de empresa | `boletos.conta_emissora` desnormalizado é a fonte da verdade das operações pós-emissão |
| Webhook da CV não registrado → baixa nunca chega | Passo 4 do rollout é bloqueante antes do passo 5; sintoma visível em Recebíveis (boletos CV eternamente em aberto) |
| Env da CV ausente/errada em produção | Gateway falha na construção com mensagem nomeando conta e variáveis; emissão MC não é afetada |

## 10. Fora de escopo (explícito)

- 3ª conta ou contas dinâmicas via UI (o registro suporta evolução, mas não há caso de uso).
- Override de conta por emissão (D1-C) — só se surgir exceção real.
- Segmentação do dashboard por conta (fase 2).
- Migração das env `CORA_*` legadas para `CORA_MC_*` na Vercel (fallback torna isso opcional; fazer por higiene quando conveniente).
