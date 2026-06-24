# Sistema de Cobrança por Guias — Carmem Cavalcante Contabilidade

Substitui contagem manual de guias hospitalares, digitação em planilha e cálculo manual
de boleto por um pipeline determinístico, segurando para revisão humana só o inconsistente.

Fonte da verdade: `PRD_sistema_cobranca.md` (regras §5, fases §10, casos de regressão §12)
e `docs/architecture.md`.

## Stack

Next.js 14 (App Router) na Vercel + Supabase (Postgres + Auth + Realtime).
Monorepo npm workspaces: `apps/web` (UI + API routes + engine) e `packages/shared` (tipos).

## Estrutura

```
apps/web/src/
├── app/                      # rotas e API routes (incl. /api/boletos)
├── components/medicos/       # MedicoForm, HistoricoTimeline, MedicosManager
├── server/
│   ├── engine/               # PORTE de motor_guias_v2.py — funções puras, sem I/O
│   ├── gateway/              # BoletoGateway: cora-gateway (mTLS) + mock-gateway + factory
│   ├── repositories/         # medico, execucao, boleto (toda escrita gera auditoria)
│   ├── integration/          # cliente de procedimentos (modo local | http)
│   ├── auth/                 # requireRole
│   └── validation/           # schemas Zod
└── lib/                      # env, supabase clients, api-error, api-client
packages/shared/src/          # tipos de domínio + engine-contracts + boleto
supabase/migrations/          # schema + RLS + seed de preços + tabela boletos
```

## Setup local

```bash
node --version   # >=20
npm install
cp .env.example apps/web/.env.local   # preencher chaves do Supabase
npx supabase start
npx supabase db push                  # aplica supabase/migrations/
npm run dev
```

## Comandos

```bash
npm test         # testes (engine + componentes + tipos) nos dois workspaces
npm run typecheck
npm run lint
npm run build
```

## Estado por fase (PRD §10)

**Fase 1 — entregue:**
- Motor portado para TypeScript (`apps/web/src/server/engine`), funções puras.
- Suite de regressão dos casos reais do PRD §12 (Dra. A: 17 guias/4 cirurgias/6 consolidado;
  Dr. E: 17 guias/16 cirurgias/49 procedimentos).
- Schema Supabase com RLS completo e seed da tabela de preços.
- Cadastro de médicos com histórico obrigatório, TIPO derivado, bloqueio de combinação inválida.
- Auth Supabase + middleware de rota protegida + papéis.

**Fase 2 — entregue:**
- Orchestrator de execução (`apps/web/src/server/orchestrator`): cria a execução, divide os
  médicos ativos em lotes encadeados (`BATCH_SIZE = 20`, ~6 lotes para 120 médicos), processa
  lote a lote (Integration Client + Engine + repositório), atualiza progresso e encadeia o
  próximo lote via HTTP interno protegido por `X-Internal-Secret` (`maxDuration = 60`).
- Repositório de execução (`execucao-repository.ts`), seguindo o padrão do medico-repository.
- Rotas: `POST/GET /api/execucoes`, `GET /api/execucoes/[id]`, `.../resultados`,
  `POST .../processar-lote` (interno).
- UI: disparo de competência (`/execucoes/nova`), progresso em tempo real via Supabase Realtime,
  relatório em 3 grupos (ok / alerta / sem_dados, PRD §8.4), histórico de execuções (PRD §8.5).
- Variação anômala (PRD §8.5): o Orchestrator busca as guias da execução concluída anterior do
  mesmo médico e alimenta `historicoGuias` no Engine (limiar de 40% em `checar()`).
- Integration Client em dois modos: `PROCEDIMENTOS_SOURCE=local` (fixtures) e `http` (API real) —
  Fase 2 roda ponta a ponta em modo local, sem depender da API da Carmem (bloqueador do PRD §11).
- Testes: unitários do Orchestrator (divisão de lotes, continuar/concluir, isolamento de falha de
  rede) e do repositório; integração de uma execução pequena (3 médicos) do disparo ao relatório
  em 3 grupos.

**Integração real com a API da Carmem — pronta, esperando só a API existir:**
- O Integration Client (`apps/web/src/server/integration/procedimentos-client.ts`) implementa o
  contrato do PRD §6.4 de ponta a ponta: `GET /api/procedimentos?competencia=AAAA-MM&cpf=...`,
  header `X-API-Key`, array vazio = médico sem produção (válido), 401 = chave inválida (sem retry),
  4xx = erro de cliente (sem retry), 5xx/rede/timeout = transitório com retry e backoff exponencial
  (até 3 tentativas, 200ms/400ms). Esgotar tentativas devolve `ApiError CARMEM_RETRY`, que o
  Orchestrator transforma em alerta do médico — uma falha não derruba a competência inteira.
- Testado com `fetch` mockado (a API real não existe; PRD §11): resposta normal, array vazio, 401,
  retry com sucesso na 2ª tentativa, esgotamento de tentativas, 5xx vs 4xx, e parsing 1:1 dos campos.

### Como ligar a API real da Carmem

Quando a API estiver no ar, a troca é **só de configuração — zero mudança de código**:

1. `PROCEDIMENTOS_SOURCE=http`
2. `CARMEM_API_URL=` (URL base do sistema da Carmem)
3. `CARMEM_API_KEY=` (chave enviada no header `X-API-Key`)

Pré-requisito de negócio que **não é do dev resolver** (PRD §11): o programador da Carmem precisa
confirmar qual campo é o CPF do médico responsável (assumimos `cpf_medico`) e se `data_emissao` é o
campo usado para filtrar a competência. Se os nomes reais divergirem do contrato, ajustar apenas
`normalizarProcedimento` no client.

**Fase 3 — gateway de boletos (Cora mTLS) — implementada, DESLIGADA por padrão:**

A emissão de boletos está implementada atrás de **dois gates** que precisam ser satisfeitos
antes de funcionar em produção:

1. **Gate técnico — certificado mTLS da Cora** (pendência externa):
   A API Banking da Cora exige autenticação via mTLS (mutual TLS). O certificado e a chave
   privada precisam ser solicitados à Cora e armazenados como base64 em env vars.

2. **Gate de negócio — feature flag `GATEWAY_EMISSAO_HABILITADA`** (decisão consciente):
   Mesmo com o certificado pronto, a flag fica `false` até que a validação em produção
   (conferência manual vs. sistema, PRD §10) confirme que os números estão corretos.
   Enquanto `false`, qualquer tentativa de emissão via API retorna 403.

Arquitetura: adapter/porta (`BoletoGatewayPort`) com implementação Cora (`cora-gateway.ts`,
mTLS via `node:https`) e mock (`mock-gateway.ts` para testes). Factory seleciona via
`BOLETO_GATEWAY=cora|mock`. Trocar de provedor não exige redesenho.

Regras de negócio:
- **Nunca emite sobre alerta/sem_dados** — apenas `status='ok'`.
- **Confirmação explícita por médico** — um resultado por vez, sem lote, sem automação ao
  concluir execução.
- **Tabela `boletos`** para auditoria (quem emitiu, quando, resposta crua do gateway).
- **Idempotência**: se já existe boleto emitido para o resultado, retorna 409.

### Como ligar a emissão de boletos

Quando os dois gates estiverem satisfeitos, a ativação é **só de configuração**:

```env
# Gate 1: certificado mTLS da Cora
BOLETO_GATEWAY=cora
CORA_CERT_BASE64=<certificado .pem em base64>
CORA_KEY_BASE64=<chave privada .key em base64>
CORA_API_URL=https://matls-clients.api.cora.com.br
CORA_CLIENT_ID=<client_id da aplicação OAuth2>

# Gate 2: decisão de negócio
GATEWAY_EMISSAO_HABILITADA=true
```

Pré-requisitos que **não são do dev resolver**:
- Solicitar certificado mTLS à Cora (pendência externa).
- Validar os números em produção antes de ligar a flag (PRD §10).

Total de testes: ~70 (62+ em apps/web, 8 em packages/shared).

**Bloqueadores de negócio em aberto (PRD §11):** campo de CPF e data de emissão da API da Carmem;
fatura real para validar faixa; faixa "outros hospitais" > 80 (Engine sinaliza, não chuta);
imobilizações na regra de teto-de-3; certificado mTLS da Cora (pendência externa).
Ver "Checklist Results Report" em `docs/architecture.md`.
