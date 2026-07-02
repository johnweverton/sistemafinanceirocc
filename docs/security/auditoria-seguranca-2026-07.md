# Auditoria de Segurança — Sistema de Cobrança por Guias

**Data:** 2026-07-01 · **Escopo:** auth, autorização, RLS, API routes, headers HTTP, segredos, dependências.

## Resumo executivo

Encontrada 1 vulnerabilidade **CRÍTICA** de escalação de privilégio (corrigida), além de hardening
de headers HTTP, import de CSV e comparação de segredo. Base já tinha boa postura: RLS em todas as
tabelas, service-role só no servidor, todas as rotas com `requireRole`, sem `eval`/`dangerouslySetInnerHTML`.

## Achados e ações

| # | Sev | Achado | Ação | Status |
|---|-----|--------|------|--------|
| 1 | 🔴 CRÍTICO | `require-role.ts` auto-provisionava qualquer usuário sem perfil como **admin**. Com signup aberto no Supabase, qualquer um virava admin. | Removido auto-admin. Só e-mails em `BOOTSTRAP_ADMIN_EMAILS` são provisionados; demais recebem 403 `SEM_PERFIL`. | ✅ Corrigido |
| 2 | 🟠 ALTO | Sem headers de segurança HTTP. | `next.config.mjs`: CSP (escopada ao Supabase), HSTS, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy; `X-Powered-By` removido. | ✅ Corrigido |
| 3 | 🟠 ALTO | Dependências vulneráveis (`npm audit`: 15). | Bump `@supabase/supabase-js` 2.45→2.74 (corrige auth-js, runtime). Majors (`next`, `vitest`) documentados abaixo. | ⚠️ Parcial |
| 4 | 🟡 MÉDIO | Import CSV (`/api/medicos/importar`) sem limite de tamanho/linhas → DoS por memória. | Cap de 5 MB e 5000 linhas (413 `ARQUIVO_GRANDE`). | ✅ Corrigido |
| 5 | 🟢 BAIXO | Comparação do `INTERNAL_SECRET` com `!==` (timing attack). | `crypto.timingSafeEqual`. | ✅ Corrigido |
| 6 | 🟡 MÉDIO | Signup aberto no Supabase (`disable_signup: false`). | **Ação do dono** (conta externa): desabilitar em Authentication > Settings. | ⏳ Pendente (usuário) |

## Ações pendentes (fora do código)

1. **Desabilitar signup** no dashboard Supabase — mitigação mais forte do vetor do achado #1.
2. **Upgrades major** (breaking, avaliar em janela dedicada com testes):
   - `next` 14.2.33 → 15+/16 (DoS HIGH, XSS postcss transitivo).
   - `vitest`/`vite`/`esbuild` → 4/latest (RCE CRÍTICO, **dev-only** — baixo risco em produção).
   - `@playwright/test`, `glob`, `eslint-config-next` (dev-only).
3. **CSP com nonce por request** (endurecer, remover `'unsafe-inline'` de script-src) — futuro.
4. **Rate-limit/lockout** no login (hoje só o throttle nativo do Supabase Auth).

## Configuração nova

- `BOOTSTRAP_ADMIN_EMAILS` (server env): allowlist de e-mails auto-provisionados como admin no
  primeiro acesso. Vazio = nenhum auto-provisionamento. Usuários com perfil existente não são afetados.

## Validação

`npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅ 78/78 · smoke runtime: headers servidos,
rotas protegidas (307 sem sessão), CSP escopada ao Supabase.
