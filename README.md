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
  em 3 grupos. Total: 50 testes (42 em apps/web, 8 em packages/shared).

**Bloqueadores de negócio em aberto (PRD §11):** campo de CPF e data de emissão da API da Carmem;
fatura real para validar faixa; faixa "outros hospitais" > 80 (Engine sinaliza, não chuta);
imobilizações na regra de teto-de-3. Ver "Checklist Results Report" em `docs/architecture.md`.
