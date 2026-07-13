# Auditoria de Segurança — Sistema de Cobrança por Guias (revisão 2026-07-13)

**Escopo:** revisão do estado atual pós auditoria de 2026-07-01 (`auditoria-seguranca-2026-07.md`) —
dependências, rate limiting, RLS/segredos, webhook, upload/import, LGPD (dados pessoais de médicos).

## Resumo executivo

A base já chegava a esta revisão com postura sólida (auditoria anterior + hardenings incrementais
registrados em comentários `Achado A-4`, `B-4`, `I-1`, `I-2`, `M-1`, `M-2`, `QA-711-2`): CSP com nonce
por request, headers HTTP completos, rate limiting nas rotas de maior custo, logging estruturado de
segurança, comparação de segredos em tempo constante, RLS em todas as tabelas, `require-role.ts` sem
escalação de privilégio. Nesta revisão: **1 gap real corrigido** (ausência de rate limit global de API)
e **1 dependência atualizada** (patch). Nenhuma vulnerabilidade crítica nova encontrada.

## Achados e ações desta revisão

| # | Sev | Achado | Ação | Status |
|---|-----|--------|------|--------|
| 1 | 🟡 MÉDIO | Rate limiting só existia em 10 rotas de escrita de maior custo (emissão de boleto, import CSV, sync). Rotas de leitura com dados pessoais (`/api/medicos/*`, `/api/execucoes/*`, dashboards) sem nenhum limite — uma sessão comprometida ou automação poderia varrer todos os médicos/CPFs em série. | Rate limit **global** por usuário em `middleware.ts` para todo `/api/*` autenticado (300 req/min), complementar aos limiters pontuais existentes. Retorna 429 com `Retry-After`. | ✅ Corrigido |
| 2 | 🟢 BAIXO | `next` 14.2.33 — 4 patches atrás (14.2.35 disponível). | Bump para `14.2.35`. `typecheck`/`lint`/`test` (501/501) e `next build` OK. | ✅ Corrigido |
| 3 | 🟡 MÉDIO | `npm audit` (produção): 6 vulnerabilidades (3 moderate, 3 high) — todas em `next` (DoS/SSRF/cache poisoning, corrigidas só em v15/16) e transitiva `postcss`/`uuid` via `exceljs`. Fix automático exige downgrade (`exceljs@3.4.0`) ou major breaking (`next@16`). | Confirmado: **sem fix não-breaking disponível**. Mantido como risco aceito e documentado (igual à auditoria anterior). | ⏳ Aceito, ver pendências |
| 4 | ℹ️ INFO | Webhook Cora (`/api/webhooks/cora/[secret]`): revisado — secret por conta em tempo constante, idempotência por `boleto_eventos.evento_id`, reconsulta na Cora como fonte da verdade (nunca confia no corpo do webhook), sempre 200 exceto secret inválido. Nenhum problema encontrado. | — | ✅ Sem achado |
| 5 | ℹ️ INFO | Import CSV/XLSX de médicos: cap de 5 MB/5000 linhas, validação de extensão, rate limit dedicado (5/min), erros por linha sem vazar detalhes internos. Exclusão em lote limitada a 50 IDs com log de auditoria (`adminId`, quantidade, IDs). Nenhum problema encontrado. | — | ✅ Sem achado |
| 6 | ℹ️ INFO | `api-error.ts`: erros 500 sempre respondem mensagem genérica ("Erro interno") ao cliente — stack trace só vai para o log do servidor. Nenhuma rota expõe CORS (`Access-Control-Allow-Origin`) — same-origin implícito do Next.js. | — | ✅ Sem achado |

## Avaliação LGPD

**Dados pessoais tratados:** CPF, nome, e-mail, WhatsApp e endereço (bloco pagador) dos médicos —
finalidade: emissão de cobrança (boleto), execução contratual/interesse legítimo.

| Princípio/obrigação | Situação | Observação |
|---|---|---|
| Segurança (Art. 46) | ✅ Boa | RLS por tabela, service-role só no servidor, TLS obrigatório (HSTS), CSP, secrets com entropia mínima validada em `env.ts`. |
| Controle de acesso | ✅ Boa | `requireRole` em 43/43 rotas de API; papéis `admin`/`colaborador`/`financeiro`; sem auto-escalação (allowlist `BOOTSTRAP_ADMIN_EMAILS`). |
| Minimização/finalidade | ✅ Adequado | Campos coletados (CPF, nome, contato, endereço) são os mínimos necessários para emissão de boleto — sem coleta de dados sensíveis (Art. 5º II) além do necessário. |
| Direito de eliminação | ✅ Existe | `/api/medicos/excluir-lote` e exclusão individual, com bloqueio se houver vínculo financeiro (integridade) e log de auditoria. |
| Prestação de contas (accountability) | ⚠️ Parcial | Há log de falhas de auth/autorização e de exclusões, mas **não há log de leitura** de dados pessoais (quem visualizou o CPF/histórico de qual médico). É uma lacuna de rastreabilidade, não de controle de acesso — aceitável para o porte atual, mas vale revisitar se o volume de usuários/dados crescer. |
| Retenção | ⚠️ Não formalizada | Não há política de retenção/expurgo automatizado documentada. Recomendo formalizar (mesmo que "reter enquanto o vínculo contratual existir") como documento, não como código. |
| Base legal / titular ciente | ⚠️ Fora do código | Consentimento/base legal com os médicos é responsabilidade contratual do dono do negócio, não do sistema — fora do escopo técnico desta auditoria. |
| Signup público no Supabase | ⏳ Pendente (repetido da auditoria anterior) | Ainda não confirmado que `disable_signup` foi desativado no dashboard do projeto `nxxhhempgmevzxbrjvbo` (auditoria não tem permissão MCP nesse projeto — conta externa). **Ação do dono.** |

## Pendências (fora do código, seguem da auditoria anterior)

1. **Desabilitar signup** no dashboard Supabase (ainda não verificável remotamente por esta sessão).
2. **Upgrade major do Next.js** (14→15/16) para eliminar as 6 vulnerabilidades restantes — breaking change, requer janela dedicada com testes de regressão completos.
3. **Formalizar política de retenção de dados pessoais** (documento, não código).
4. (Opcional, não bloqueante) Log de leitura de dados pessoais para accountability LGPD mais forte, se o produto crescer.

## Configuração nova

- Rate limiter global `api-global` em `apps/web/src/middleware.ts` (300 req/min por usuário autenticado, todas as rotas `/api/*`), usando a infraestrutura já existente em `lib/rate-limit.ts`.

## Validação

`npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅ 501/501 · `npm run build` ✅ (middleware Edge-compatible, 68.1 kB) · `npm audit --omit=dev` 6 vulnerabilidades remanescentes, todas sem fix não-breaking (documentadas acima).

Mudanças ainda **não commitadas** (working dir em `master`). Commit/push seguem o fluxo do @devops.
