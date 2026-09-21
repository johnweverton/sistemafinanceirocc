# HANDOFF — Épico 13 (agente de faturamento ISS Fortaleza)

> **Leia só este arquivo para retomar.** Ele resume uma sessão longa (2026-09-21). Aprofunde nos
> arquivos citados apenas se precisar do detalhe. A memória do Claude (`~/.claude/…/memory`) ficou
> na máquina anterior e **não** vem junto: o que importa está aqui.

## Onde está o código
Branch **`feat/epico-13-agente-iss`** (a partir de `master` @ `1adcec5`). Na outra máquina:
```
git fetch origin && git switch feat/epico-13-agente-iss && npm install
```

## Objetivo
Clientes contábeis em modo `faixa_faturamento` têm boleto de R$250,00 (faturamento < R$5.000) ou
R$480,56 (≥ R$5.000). Hoje o operador busca o faturamento **à mão** no portal ISS Fortaleza, empresa
por empresa. O agente lê o valor no portal e o entrega como **proposta** no diálogo de lote
(`LoteContabilidadeDialog.tsx`), que já existe. O processo manual está em `docs/Processo ISS.docx`.

## Decisões do dono (não reabrir)
| # | Decisão |
|---|---|
| G1 | Fonte = escrituração do ISS Fortaleza. O dono confirmou com a SEFIN que ela continua com as notas depois da migração do Simples ao Emissor Nacional (01/11/2026). Guarda R5 detecta se isso mudar. |
| G2 | O agente pode **Dar Ciência** em comunicados sozinho, guardando o PDF. *(Ainda não implementado, ver Pendências.)* |
| G3 | O valor entra como **proposta** (`iss_capturas`), e o operador confirma. Nunca sobrescreve lançamento manual; divergência vira alerta. O agente **nunca** grava em `clientes_contabilidade_faturamentos`. |
| G4 | O agente é um **CLI local** no escritório, com token dedicado (sem service role). Senha só em `%USERPROFILE%\agente-iss\.env`, **fora do OneDrive**. |
| — | Preferência do dono: **validar no sistema real antes de automatizar** (gravar tela/HTML real). Nada de seletor por suposição. |

## Estado
| Story | Status | O que é |
|---|---|---|
| 13.0 | Feita (absorvida na 13.2) | Gravação real do portal em 2026-09-21 → seletores + fixtures |
| 13.1 | InReview | Servidor: migration `0061_agente_iss.sql`, rotas `GET /api/integracoes/iss/alvos` e `POST /api/integracoes/iss/execucoes` (bearer token, SHA-256 em `AGENTE_ISS_TOKEN_SHA256`), R5, `listarPropostasIssVigentes` |
| 13.2 | InReview (**falta validação ao vivo**) | CLI `apps/agente-iss` → `npm run iss:faturamento` |
| 13.3 | Não iniciada | UI: pré-preencher propostas no `LoteContabilidadeDialog` (selos, divergência R4, `origem` no lançamento) — ver arquitetura §6 |

Testes na saída desta sessão: suíte completa verde (web 138 arquivos, agente 51 testes, shared).

## Próximos passos (em ordem)
1. **Validação ao vivo da 13.2** (AC 9). Na máquina que vai rodar o agente, crie
   `%USERPROFILE%\agente-iss\.env` com `ISS_CPF=` e `ISS_SENHA=` e rode:
   ```
   npm install
   npm run iss:faturamento -- --offline --headed --competencia 2026-08 --cnpj 08293377000198 --cnpj 07286006000116
   ```
   Confira: os valores batem com a tela? O log diz "percorrendo a lista completa"? Se disser, a
   pesquisa por CNPJ não filtrou e o fallback de paginação foi usado. Se algo falhar, os snapshots
   ficam em `%USERPROFILE%\agente-iss\execucoes\<carimbo>\snapshots\`: leia o HTML e ajuste
   `src/portal/seletores.ts`.
2. **Dono**: aplicar `supabase/migrations/0061_agente_iss.sql` no Supabase (conta externa, ref
   `nxxhhempgmevzxbrjvbo`); gerar o token (comando em `docs/stories/13.1…md` › Dev Notes); pôr
   `AGENTE_ISS_TOKEN_SHA256` na Vercel e `AGENTE_ISS_TOKEN` + `SISTEMA_URL` no `.env` do agente.
3. **13.3** (UI), que pode começar em paralelo ao passo 1.
4. **Dar Ciência (G2)**: gravar o fluxo com `node apps/agente-iss/scripts/gravador.cjs` quando
   uma empresa tiver comunicado pendente, e só então automatizar. Hoje: empresa com comunicado →
   status `erro` + snapshot (falha segura).
5. @qa gate das 13.1/13.2 (as stories foram escritas e implementadas sem @sm/@po, a pedido do dono).

## Fatos do portal que não são óbvios (vieram da gravação real)
- RichFaces 3.3.3 com **ids estáveis**: `alteraInscricaoForm:*` (modal de inscrição),
  `manterEscrituracaoForm:*`, `abaEncerramentoForm:dataTableServicosPrestados`. Nunca usar `j_idNNN`.
- **Valor = `tfoot` da tabela Serviços Prestados, coluna "Valor do Serviço"** (achada pelo título). As
  linhas do corpo variam (a linha C "ISS Retido pelo Tomador" só existe em algumas). A tabela "Imposto
  sobre Serviços" também tem Somatório e pode ser 0,00 quando o certo é 8.000,00.
- Inscrição: `0196992-7` na lista × `196992-7` no cabeçalho. Comparar sem zero à esquerda.
- Filtro De/Até = campo oculto `manterEscrituracaoForm:dataInicialInputDate` (`MM/AAAA`). O servidor
  re-renderiza o valor aceito, e o agente confere antes de concluir "sem escrituração".
- Visualização: campo oculto `#dataCompentencia` (`01/MM/AAAA`, grafia do portal) para a verificação R1.
- Na linha do "Visualizar" ficam **Escriturar/Reabrir** (escrita): nunca tocar.
- Login Keycloak: `#username` (CPF só dígitos), `#password`, `#botao-entrar`, erro `.login-error-msg`.
  O agente faz **uma tentativa só**, para não bloquear o usuário MASTER da CEO.
- O portal logado imprime o CPF da CEO no HTML. Todo HTML salvo pelo agente/gravador tem o CPF removido.

## Mapa de arquivos
- Arquitetura: `docs/architecture/feature-agente-faturamento-iss.md` (decisões D1–D5, regras R1–R6, UX §6)
- Stories: `docs/stories/13.1.agente-iss-fundacao.story.md`, `docs/stories/13.2.agente-iss-cli.story.md`
- Servidor: `apps/web/src/server/repositories/iss-captura-repository.ts`,
  `apps/web/src/app/api/integracoes/iss/*`, `apps/web/src/server/auth/require-agente-token.ts`,
  `apps/web/src/server/engine/alertas-captura-iss.ts`, tipos em `packages/shared/src/types/agente-iss.ts`
- Agente: `apps/agente-iss/` → `README.md` (operação), `src/portal/seletores.ts`, `src/portal/portal.ts`,
  `src/extracao/extracao.ts`, `src/cli.ts`, `scripts/gravador.cjs`, `tests/fixtures/*.html` (HTML real anonimizado)

## Avisos para a próxima sessão
- **Fora deste commit, de propósito**: alterações que já estavam no working tree antes do Épico 13
  (`processar-medico.ts`, `fin-api-client.ts`, `execucao-orchestrator.ts`,
  `processar-medico-acumulado.test.ts`, `execucao-orchestrator-instabilidade-3x1.test.ts`). Pertencem a
  outro trabalho e continuam **apenas na máquina anterior**.
- As gravações brutas do portal (`%USERPROFILE%\agente-iss\reconhecimento\…`) ficaram na máquina
  anterior. O que importa delas está nos fixtures anonimizados.
- `npm install` é necessário: liga o workspace `apps/agente-iss` e instala o `recharts`, que faltava.
- Achado **não verificado** e fora do escopo: o `middleware.ts` não libera `/api/cron`, então o cron
  do relatório mensal pode estar sendo redirecionado para `/login`. Vale checar à parte.
