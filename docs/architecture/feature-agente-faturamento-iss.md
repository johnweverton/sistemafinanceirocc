# Arquitetura — Agente de captura de faturamento no ISS Fortaleza

**Autor:** @architect (via Claude Code) · **Data:** 2026-09-21 · **Status:** Decisões do dono fechadas — pronto para @sm quebrar em stories (Épico 13)
**Fonte do processo:** `docs/Processo ISS.docx` (passo a passo manual com 12 capturas de tela)

**Contexto:** no modo `faixa_faturamento` (Épico 11/12), o valor do boleto de contabilidade depende do
faturamento da competência (< R$5.000 → R$250,00; ≥ R$5.000 → R$480,56). Hoje o operador busca
esse número **à mão** no portal ISS Fortaleza, empresa por empresa, e digita no diálogo de lote
(`LoteContabilidadeDialog.tsx`). Este documento desenha um agente que faz a coleta e entrega o
valor **como proposta** no mesmo diálogo — o destino (`clientes_contabilidade_faturamentos`,
`lancarFaturamentoLote`) já existe e não muda.

## 0. Decisões do dono (2026-09-21)

| # | Pergunta | Decisão |
|---|----------|---------|
| G1 | Migração para o Emissor Nacional (Comunicado SEFIN 06/2026: ME/EPP do Simples a partir de 01/11/2026) tira as notas da escrituração do ISS? | **Não** — confirmado com a SEFIN que a escrituração continua trazendo as notas. Construir sobre o ISS Fortaleza. (Ver guarda de sanidade R5.) |
| G2 | O agente pode "Dar Ciência" em comunicados oficiais em nome das empresas? | **Sim**, automaticamente, **guardando o PDF** do comunicado e registrando no relatório da execução. |
| G3 | O valor capturado entra direto ou como proposta? | **Proposta para conferência.** O operador confirma no diálogo de lote. Nunca sobrescreve valor já lançado; divergência vira alerta. |
| G4 | Onde roda? | **Script local no escritório** (CLI), senha só na máquina local. |

## 1. O processo manual, traduzido em passos automatizáveis

| Passo do documento | Tela (URL) | O que o agente faz |
|---|---|---|
| 1–3 Login | `iss.fortaleza.ce.gov.br/grpfor/login.seam` → Keycloak `idp2.sefin.fortaleza.ce.gov.br` | "Fazer login" → preenche CPF/Senha do perfil **MASTER** (CEO) → "Entrar". Guarda `storageState` para reaproveitar a sessão. |
| 4–5 Selecionar empresa | Modal "SELECIONE INSCRIÇÃO" (`home.seam`) | Rádio **CNPJ** + campo de pesquisa + "Pesquisar" → clica na linha. Não pagina a lista (são 9+ páginas). |
| 6 Comunicado | Modal "VISUALIZAR MENSAGENS" | Se aparecer: abre o anexo → "Baixar" (captura o download) → "Voltar" → "Dar Ciência". Sem essa ordem o portal bloqueia com pop-up. |
| 7 Escrituração | Menu Escrituração → "Manter Escrituração" (`pages/escrituracao/manterEscrituracao.seam`) | Navega pelo menu (a URL carrega `cid` de conversação Seam — não dá para ir direto). |
| 8 Filtro | De/Até = competência → "Consultar" | Competência padrão = **mês anterior** ao da execução (em set/2026 → 08/2026). |
| 9 Resultado | Tabela "Resultado da Consulta" | Lê a linha da competência: **Situação** (ex.: "Fechada - Retificadora(1)", "Aberta - Normal") e clica em **Visualizar**. |
| 10 Valor | `visualizacao/visualizacaoEscrituracao.seam`, aba Encerramento, bloco "Documentos Fiscais" | Tabela **Serviços Prestados**, linha **Somatório**, coluna **Valor do Serviço** (ex.: `618,84`) = faturamento da competência. Também guarda a Quantidade. |
| 11–12 Próxima empresa | Botão ⇄ "Inscrição Atual" → mesma lista → confirmação "A operação atual será abortada…" | Clica **Sim** e repete para a próxima empresa. |

## 2. Decisões estruturais

### D1 — Onde o agente roda: CLI local, workspace próprio `apps/agente-iss`

Um navegador automatizado (Playwright/Chromium) não cabe nas funções da Vercel, e a varredura de
dezenas de empresas (~1 min cada) passa do limite de tempo delas. Por isso (G4) o agente é um CLI
Node executado numa máquina do escritório:

```bash
npm run iss:faturamento                          # competência = mês anterior
npm run iss:faturamento -- --competencia 2026-08
npm run iss:faturamento -- --cnpj 08293377000198 # uma empresa só (reprocessar/depurar)
npm run iss:faturamento -- --headed              # mostra o navegador (depuração)
```

Fica num **workspace separado** (`apps/agente-iss`), e não dentro de `apps/web`, para que o
Chromium e o Playwright de runtime nunca entrem no build da Vercel. Tipos compartilhados vêm de
`@cobranca/shared`.

### D2 — Como o agente fala com o sistema: API com token dedicado, **não** service role

A máquina do escritório **não** recebe `SUPABASE_SERVICE_ROLE_KEY`, que dá poder total no banco.
Em vez disso, duas rotas estreitas, autenticadas por `AGENTE_ISS_TOKEN` (bearer; a Vercel guarda
só o hash SHA-256 em `AGENTE_ISS_TOKEN_SHA256`):

- `GET /api/integracoes/iss/alvos?competencia=YYYY-MM` → clientes ativos em `faixa_faturamento`
  com `{ id, nome, cnpj }` (só o necessário para localizar a empresa no portal).
- `POST /api/integracoes/iss/execucoes` → cria a execução do agente, envia as capturas (lote) e
  o relatório de ciências. Grava **só** em `iss_capturas` / `iss_execucoes_agente` — nunca em
  `clientes_contabilidade_faturamentos` (G3).

Se o token vazar, o estrago se limita a ler CNPJ/nome dos clientes de faixa e a criar
propostas, que ainda passam pela conferência humana.

### D3 — Proposta separada do lançamento oficial (G3)

Capturas vão para uma tabela nova `iss_capturas`. O lançamento oficial continua sendo o
`lancarFaturamentoLote` existente, disparado pelo operador. `clientes_contabilidade_faturamentos`
ganha só `origem` (`'manual' | 'iss_fortaleza'`) e `iss_captura_id`, para a trilha de auditoria
dizer de onde veio o número.

### D4 — Casamento empresa ↔ cliente pelo CNPJ

A chave é `clientes_contabilidade.pagador_documento` (só dígitos) = coluna "CPF/CNPJF" do modal
de inscrição. O agente pesquisa pelo CNPJ (rádio "CNPJ" do modal), então não depende de
razão social nem de paginação. Os resultados possíveis:

| Situação | `status` da captura |
|---|---|
| Achou a competência e leu o valor | `capturado` |
| CNPJ não aparece no perfil MASTER (outro município, sem vínculo) | `nao_encontrado` |
| Empresa achada, mas a competência não existe na escrituração | `sem_escrituracao` (**não** vira zero) |
| Tela fora do esperado, timeout, asserção de sanidade falhou | `erro` (com mensagem + screenshot local) |

### D5 — Ciência automática com evidência (G2)

Ao dar ciência, o agente salva o PDF em
`%USERPROFILE%\agente-iss\comunicados\{cnpj}\{data}-{arquivo}.pdf` e envia no relatório
`{ cnpj, assunto, dataComunicado, arquivo, cienciaEm }`. A tabela `iss_execucoes_agente.ciencias`
(jsonb) fica como registro consultável de "o sistema deu ciência em nome de X, em tal data". O
PDF fica **fora** do OneDrive do repositório e fora do banco (não há motivo para subir PDF de
comunicado público para o Supabase).

## 3. Regras de negócio e guardas de sanidade

- **R1 — Nunca ler a empresa errada.** Depois de trocar de inscrição e de novo na tela de
  visualização, o agente confere que "Inscrição Atual: … RAZÃO SOCIAL" corresponde ao CNPJ
  pesquisado, e que o campo "Competência" da visualização = competência alvo. Se não bater,
  a captura vira `erro`. Esta é a guarda mais importante: um valor da empresa vizinha gera
  boleto errado.
- **R2 — Competência aberta.** Se a Situação começar com "Aberta", a captura sai `capturado` com
  `competencia_fechada = false`. A UI mostra o aviso "competência ainda aberta no ISS — valor pode
  mudar". A empresa **não** fica bloqueada: quem decide é o operador.
- **R3 — Retificadora.** Situação "Fechada - Retificadora(n)" é normal. O valor da visualização já
  é o vigente. A situação completa é guardada em `situacao_iss`.
- **R4 — Não sobrescreve.** Se já existe lançamento na competência com valor ≠ capturado, a UI
  mostra a divergência ("lançado R$ X · ISS R$ Y") e **não** preenche o campo. Relançar é uma
  decisão explícita do operador.
- **R5 — Guarda de migração (defesa em profundidade ao G1).** Se a competência for ≥ 2026-11 e o
  valor capturado for 0 para um cliente com faturamento > 0 em alguma das últimas 3
  competências, a captura ganha o alerta `possivel_nota_fora_escrituracao`. Custa uma consulta e
  detecta o dia em que a escrituração deixar de refletir o Emissor Nacional.
- **R6 — Valor.** Parser pt-BR (`4.330,18` → `4330.18`) em função pura e testada. A linha é
  localizada pelo **texto** "Somatório" dentro da tabela cujo cabeçalho é "Serviços Prestados"
  (não pela posição, porque a tabela "Serviços Tomados" logo abaixo tem a mesma estrutura).

## 4. Modelo de dados — migration `0054_agente_iss.sql`

```sql
create table iss_execucoes_agente (
  id uuid primary key default gen_random_uuid(),
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  iniciado_em timestamptz not null,
  finalizado_em timestamptz,
  maquina text,                       -- hostname do escritório (rastreio)
  versao_agente text,
  totais jsonb not null default '{}', -- {capturado, nao_encontrado, sem_escrituracao, erro}
  ciencias jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table iss_capturas (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references iss_execucoes_agente(id),
  cliente_contabilidade_id uuid not null references clientes_contabilidade(id),
  competencia text not null,
  status text not null check (status in ('capturado','nao_encontrado','sem_escrituracao','erro')),
  valor_servicos_prestados numeric(12,2),        -- not null quando status = 'capturado'
  quantidade_notas integer,
  situacao_iss text,                              -- ex.: 'Fechada - Retificadora(1)'
  competencia_fechada boolean,
  inscricao_municipal text,
  razao_social_iss text,
  alertas text[] not null default '{}',           -- ex.: {'possivel_nota_fora_escrituracao'}
  mensagem_erro text,
  capturado_em timestamptz not null default now(),
  constraint chk_iss_capturas_valor check (status <> 'capturado' or valor_servicos_prestados >= 0)
);
-- A proposta vigente é a captura mais recente por (cliente, competência):
create index idx_iss_capturas_cliente_comp on iss_capturas (cliente_contabilidade_id, competencia, capturado_em desc);

alter table clientes_contabilidade_faturamentos
  add column origem text not null default 'manual' check (origem in ('manual','iss_fortaleza')),
  add column iss_captura_id uuid references iss_capturas(id);
-- RLS: select para has_profile(); escrita só via service role nas rotas (mesmo padrão da 0031).
```

As capturas são **append-only** (histórico de todas as execuções). "Proposta vigente" = a mais
recente. Isso permite reexecutar o agente no mesmo mês sem perder o que foi lido antes.

## 5. Componentes

```
apps/agente-iss/                       (NOVO workspace — CLI, nunca vai para a Vercel)
  src/cli.ts                           args, orquestra, imprime relatório final
  src/config.ts                        lê %USERPROFILE%\agente-iss\.env (fora do OneDrive)
  src/api-client.ts                    GET alvos / POST execução (bearer AGENTE_ISS_TOKEN)
  src/portal/sessao.ts                 login Keycloak, storageState, re-login ao expirar (20 min)
  src/portal/inscricao.ts              trocar inscrição por CNPJ + confirmação "Sim" + asserção R1
  src/portal/comunicados.ts            fluxo de ciência (anexo → Baixar → Voltar → Dar Ciência)
  src/portal/escrituracao.ts           filtro De/Até, linha da competência, Visualizar
  src/portal/selectors.ts              TODOS os seletores num lugar só (portal muda → 1 arquivo)
  src/extracao/extrair-somatorio.ts    FUNÇÃO PURA: html → {valor, quantidade}  (R6)
  src/extracao/valor-br.ts             FUNÇÃO PURA: '4.330,18' → 4330.18
  tests/fixtures/*.html                HTML real capturado no reconhecimento (sem dados sensíveis)

apps/web/ (ADAPT)
  src/app/api/integracoes/iss/alvos/route.ts        NOVO — token dedicado (D2)
  src/app/api/integracoes/iss/execucoes/route.ts    NOVO — token dedicado (D2)
  src/server/auth/require-agente-token.ts           NOVO — compara SHA-256 em tempo constante
  src/server/repositories/iss-captura-repository.ts NOVO — gravar execução/capturas, propostas vigentes, R5
  cliente-contabilidade-faturamento-repository.ts   ADAPT — aceita origem/iss_captura_id
  LoteContabilidadeDialog.tsx                       ADAPT — pré-preenche propostas (seção 6)
```

**Sequência de uma execução:** `GET alvos` → login → para cada alvo (em série, 1 navegador):
trocar inscrição → [ciência] → escrituração → visualizar → extrair → asserções → próxima.
No fim, um `POST execucoes` com tudo. Se o POST falhar, o JSON fica salvo em
`%USERPROFILE%\agente-iss\execucoes\` e `--reenviar <arquivo>` o reenvia sem abrir o portal de novo.

## 6. UX no diálogo de lote (reuso de `LoteContabilidadeDialog`)

- Os campos de faturamento dos clientes `faixa_faturamento` **vêm pré-preenchidos** com a
  proposta vigente do ISS e um selo "ISS · Fechada 03/09" (ou "ISS · competência aberta" em âmbar).
  O operador revisa e usa o botão "Lançar" que já existe. O lançamento sai com
  `origem = 'iss_fortaleza'` quando o valor enviado é igual ao da proposta.
- Divergência com lançamento já existente (R4): o campo não é pré-preenchido, e aparece
  "lançado R$ X · ISS R$ Y".
- Faixa-resumo acima da lista: "Última captura do ISS: 21/09 10:42 — 34 capturados · 2 não
  encontrados · 1 sem escrituração · 1 erro". Um link expande a lista dos que precisam de
  digitação manual.
- Sem proposta → comportamento atual (campo vazio). O agente **acelera** o fluxo manual e não
  o substitui.

## 7. Segurança

- **Credencial da CEO:** `ISS_CPF`/`ISS_SENHA` só em `%USERPROFILE%\agente-iss\.env`. Esse arquivo
  fica **fora** da pasta OneDrive (o repositório está no OneDrive, e um `.env` ali seria
  sincronizado para a nuvem). Nunca vai para o banco, para a Vercel ou para logs.
- `storageState` (cookies de sessão) fica na mesma pasta e é apagado ao fim da execução.
- Logs e screenshots de erro mascaram CPF. O screenshot só é salvo localmente.
- O agente só **lê** o portal, com uma exceção autorizada: Dar Ciência (G2). Nenhum outro clique
  de escrita: não fecha escrituração, não reabre, não emite nota. A lista de ações permitidas é
  explícita em `selectors.ts`.
- Ritmo de uso: execução em série, uma sessão, pausas curtas entre empresas. É o mesmo uso de um
  humano, só que sem erro de digitação.

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Portal muda layout/seletores | Seletores centralizados + asserções de sanidade (R1); falha vira `erro` por empresa, não lança valor errado; testes de extração com fixtures reais |
| Sessão expira (timer de 20 min visível) | Detecta redirecionamento ao login e reautentica; retoma da empresa atual |
| Login passar a exigir MFA/captcha | Hoje não exige (imagem 2). Se passar a exigir: `--headed` + o operador resolve e o agente continua (human-in-the-loop, mesmo padrão do ARCUS D8) |
| Escrituração deixar de refletir o Emissor Nacional | Dono confirmou com a SEFIN (G1); R5 detecta automaticamente se acontecer |
| Ler valor da empresa errada | R1 (dupla verificação de inscrição + competência) |

## 9. Fora de escopo

- Clientes em modo `fixo` (não dependem de faturamento).
- Empresas de outros municípios (Natal, Mossoró, Sergipe): ficam `nao_encontrado`, digitação manual.
- Agendamento automático e botão "Buscar do ISS" no sistema (G4 escolheu CLI local; evolução futura
  possível reaproveitando o mesmo driver num worker).
- Emissão de NFS-e: pertence ao ARCUS (pasta irmã). Se o ARCUS precisar de um driver RPA de
  Fortaleza, `apps/agente-iss/src/portal/` é o ponto de partida.

## 10. Quebra sugerida em stories (Épico 13)

| # | Story | Depende de | Foco |
|---|-------|-----------|------|
| 13.0 | Reconhecimento do portal (spike) | — | Sessão assistida no portal real: capturar DOM/seletores de cada tela, HTML-fixture da visualização (anonimizada) e o comportamento quando a competência não existe. Saída: `selectors.ts` + fixtures |
| 13.1 | Fundação: migration 0054, tipos, repository, rotas com token | — | `iss_execucoes_agente`, `iss_capturas`, `origem`; `/api/integracoes/iss/*`; R5 |
| 13.2 | Agente CLI: driver Playwright + extração | 13.0, 13.1 | `apps/agente-iss`; login, troca de inscrição, ciência, escrituração, R1/R2/R6, relatório, `--reenviar` |
| 13.3 | Propostas no diálogo de lote | 13.1 | Pré-preenchimento, selos, divergência (R4), faixa-resumo, `origem` no lançamento |

13.1 e 13.0 são paralelizáveis. 13.3 pode ser desenvolvida contra capturas de teste inseridas à mão.
