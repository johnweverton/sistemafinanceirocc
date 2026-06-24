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
├── app/                      # rotas e API routes
├── components/medicos/       # MedicoForm, HistoricoTimeline, MedicosManager
├── server/
│   ├── engine/               # PORTE de motor_guias_v2.py — funções puras, sem I/O
│   ├── repositories/         # medico-repository (toda escrita gera histórico)
│   ├── integration/          # cliente de procedimentos (modo local | http)
│   ├── auth/                 # requireRole
│   └── validation/           # schemas Zod
└── lib/                      # env, supabase clients, api-error, api-client
packages/shared/src/          # tipos de domínio + engine-contracts
supabase/migrations/          # schema + RLS + seed de preços
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

**Fase 1 — entregue nesta sessão:**
- Motor portado para TypeScript (`apps/web/src/server/engine`), funções puras.
- Suite de regressão dos casos reais do PRD §12 (Dra. A: 17 guias/4 cirurgias/6 consolidado;
  Dr. E: 17 guias/16 cirurgias/49 procedimentos).
- Schema Supabase com RLS completo e seed da tabela de preços.
- Cadastro de médicos com histórico obrigatório, TIPO derivado, bloqueio de combinação inválida.
- Auth Supabase + middleware de rota protegida + papéis.

**Fase 2 — preparada, não ativada:**
- O Integration Client já aceita `PROCEDIMENTOS_SOURCE=local` (fixtures) e `http` (API real),
  para não bloquear na API da Carmem que ainda não existe (PRD §11). Falta: telas de execução,
  relatório em 3 grupos e o orquestrador de lotes encadeados (`BATCH_SIZE=20`, `maxDuration=60s`).

**Bloqueadores de negócio em aberto (PRD §11):** campo de CPF e data de emissão da API da Carmem;
fatura real para validar faixa; faixa "outros hospitais" > 80 (Engine sinaliza, não chuta);
imobilizações na regra de teto-de-3. Ver "Checklist Results Report" em `docs/architecture.md`.
