# HANDOFF — Épico 13 (agente de faturamento ISS Fortaleza)

> **Leia só este arquivo para retomar.** Ele resume uma sessão longa (2026-09-21). Aprofunde nos
> arquivos citados apenas se precisar do detalhe. A memória do Claude (`~/.claude/…/memory`) ficou
> na máquina anterior e **não** vem junto: o que importa está aqui.

## Onde está o código
Branch **`feat/epico-13-agente-iss`** (a partir de `master` @ `1adcec5`). Na outra máquina:
```
git fetch origin && git switch feat/epico-13-agente-iss && npm install
```
As Fases 1 e 2 (Stories 13.4 e 13.5, 2026-09-28) estão na branch **`feat/epico-13-agente-iss-ux`**
(a partir da `master` já com o PR #2), ainda não mergeada.

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
Mergeado na `master` pelo PR #2 (2026-09-21) e **validado em produção** (`cobrancacc.vercel.app`).

| Story | Status | O que é |
|---|---|---|
| 13.0 | Feita (absorvida na 13.2) | Gravação real do portal em 2026-09-21 → seletores + fixtures |
| 13.1 | Done (validada em produção) | Servidor: migration `0061_agente_iss.sql` (aplicada), rotas `GET /api/integracoes/iss/alvos` e `POST /api/integracoes/iss/execucoes` (bearer token, SHA-256 em `AGENTE_ISS_TOKEN_SHA256`, configurada na Vercel), R5, `listarPropostasIssVigentes` |
| 13.2 | Done (validada ao vivo) | CLI `apps/agente-iss` → `npm run iss:faturamento` |
| 13.3 | Done (validada em produção) | UI: propostas do ISS no `LoteContabilidadeDialog` (selos, divergência R4, `origem` conferida no servidor) — ver `docs/stories/13.3.agente-iss-propostas-no-lote.story.md` |
| 13.4 | Ready for Review (branch `feat/epico-13-agente-iss-ux`, commit `2c00bf1`) | Fase 1 — uso simplificado: selo em 3 estados, reenvio automático, modo assistente, `iss:configurar`, atalho `.cmd` |
| 13.5 | Ready for Review (mesma branch, não mergeada) | Fase 2 — botão **"Buscar no ISS"** no diálogo de lote: solicitação no banco (`iss_solicitacoes`, migration **0062 ainda NÃO aplicada**), rotas do operador e do agente, agente em `--vigiar`/`--uma-vez` + tarefa agendada (`scripts/agente-iss/instalar-tarefa-agendada.cmd`) — ver `docs/stories/13.5.agente-iss-disparo-pelo-sistema.story.md` |

### Fase 2 (Story 13.5) em uma frase
O operador clica em "Buscar no ISS" → `POST /api/clientes-contabilidade/faturamentos/iss-solicitacoes`
cria a solicitação `pendente` (uma ativa por competência, índice único parcial) → a tarefa agendada do
escritório roda `--uma-vez` a cada minuto e reivindica em `GET /api/integracoes/iss/solicitacoes/proxima`
→ lê o portal mandando `.../progresso` a cada empresa → `POST /execucoes` com `solicitacaoId` →
`.../concluir`. A tela faz polling de 5 s enquanto ativa e revalida as propostas a cada tick. A senha do
ISS continua só no `.env` local (G4).

### Validação real (2026-09-21)
- `--offline` com 2 CNPJs de teste: login OK, valores conferidos pelo dono contra o portal.
- Envio real com `--limite 2` (AQG SERVICOS MEDICOS LTDA R$ 23.202,42 e BERCI SERVICOS MEDICOS LTDA
  R$ 2.917,93, competência 2026-08): execução aceita pelo servidor, 2 capturados, 0 erros.
- Em **Clientes Contábeis › Calcular em lote** (competência 2026-08) os dois campos vêm
  pré-preenchidos, com o selo "ISS · Fechada - Retificadora(N) · capturado em 21/09" e a faixa-resumo
  da última captura. Ainda **não** foi clicado "Lançar faturamentos e continuar" com esses valores.
- Os 2 CNPJs de teste usados na gravação **não** são clientes `faixa_faturamento` ativos com
  `pagadorDocumento`: no envio real o agente os ignora ("não são clientes ativos em faixa de
  faturamento"). Para testar o envio use `--limite N`, que pega os primeiros alvos reais.
- Na 2ª execução, as duas empresas caíram no fallback "pesquisa não trouxe a empresa — percorrendo a
  lista completa" (~15 s por empresa em vez de ~12 s). Resultado correto; se muitas empresas da
  carteira caírem nele, investigar por que a pesquisa por CNPJ não filtrou.

Testes: suíte do web com 6 falhas **fora do Épico 13** (2 em `guias-manuais-import.test.ts`, já
falhavam; 4 em `medico-repository-duplicata.test.ts`, teste de 08/09 sem a implementação).

## Próximos passos (em ordem)
0. **Fases 1 e 2 (13.4/13.5), branch `feat/epico-13-agente-iss-ux`:**
   1. **Aplicar `supabase/migrations/0062_iss_solicitacoes.sql` no Supabase** (SQL Editor, manual, como a
      0061). Sem ela o botão "Buscar no ISS" vira o aviso "Não foi possível verificar as buscas no ISS
      pelo sistema" — o resto do diálogo funciona normalmente.
   2. @qa gate das 13.4 e 13.5; merge na `master` (PR) e deploy.
   3. No computador do escritório: `git pull`, `npm install`, `npm run iss:configurar` (se ainda não
      feito) e **uma vez** `scripts\agente-iss\instalar-tarefa-agendada.cmd` (ou `/oculta`, sem janela).
   4. Validar ao vivo: "Buscar no ISS" numa competência real (progresso N/total, campos se preenchendo),
      "Cancelar busca" no meio, "Tentar de novo" numa empresa não encontrada, e desligar o agente para
      ver o aviso de "parece desligado" (3 min). Log do agente: `%USERPROFILE%\agente-iss\vigiar.log`.
1. **Rodar a carteira inteira** de uma competência: `npm run iss:faturamento -- --competencia AAAA-MM`
   (~12–15 s por empresa; ~90 empresas ≈ 20–25 min). Conferir no diálogo de lote quantas vêm
   pré-preenchidas, quantas caem em "digitação manual" e o log de "percorrendo a lista completa".
2. **Dar Ciência (G2)**: gravar o fluxo com `node apps/agente-iss/scripts/gravador.cjs` quando
   uma empresa tiver comunicado pendente, e só então automatizar. Hoje: empresa com comunicado →
   status `erro` + snapshot (falha segura).
3. @qa gate das 13.1/13.2/13.3 (as stories foram escritas e implementadas sem @sm/@po, a pedido do dono).
4. Depois de conferir um lote real, validar o lançamento com `origem = 'iss_fortaleza'` e o texto
   "lançado R$ X · confere com o ISS" ao reabrir o diálogo.

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
- Fase 2 (13.5): `supabase/migrations/0062_iss_solicitacoes.sql`,
  `apps/web/src/server/repositories/iss-solicitacao-repository.ts` (máquina de estados),
  `apps/web/src/app/api/integracoes/iss/solicitacoes/*`, `apps/web/src/app/api/clientes-contabilidade/faturamentos/iss-solicitacoes/*`,
  `apps/web/src/components/clientes-contabilidade/SolicitacaoIssPainel.tsx`, `apps/web/src/lib/solicitacao-iss.ts`,
  `apps/agente-iss/src/executar-competencia.ts` (miolo de uma rodada), `apps/agente-iss/src/vigiar.ts`,
  `scripts/agente-iss/instalar-tarefa-agendada.cmd`
- Scripts `.cmd` são **só ASCII** (acento em UTF-8 quebra o cmd.exe) e saem com CRLF pelo `.gitattributes`.

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
