# UX — Auditoria e mapeamento da área de Emissões (médico/empresa + clientes de contabilidade)

**Autor:** @ux-design-expert · **Data:** 2026-08-25 · **Status:** Insumo para decisão do dono — não vira story sem validação
**Contexto:** o sistema tem hoje **duas verticais de cobrança** que compartilham o mesmo pipeline
(`execucoes → execucao_resultados → boletos`) mas divergiram na experiência: a cobrança médica
(Épicos 6–10) e a cobrança de honorários contábeis (Épico 11,
`docs/architecture/feature-emissao-contabilidade.md`). O cálculo em lote de clientes contábeis
(commit `a273030`, 2026-08-20) foi a primeira vez que a vertical de contabilidade ganhou uma
operação de massa — e expôs o quanto os dois lados falam línguas diferentes para a mesma tarefa.
Este documento é **auditoria de UX + mapeamento do comportamento real do código**, para @pm/@sm
decidirem o recorte das próximas stories. Nenhum código de produto foi alterado.

**Escopo auditado:**
`clientes-contabilidade/{EmissaoCliente,FaturamentoEEmissao,GerarExecucao,DetalheCliente,ClientesContabilidadeManager,LoteContabilidadeDialog}.tsx`,
`execucoes/{NovaExecucao,HistoricoExecucoes,HistoricoExecucoesPorMedico,LoteEmissaoDialog,RelatorioGrupos,ProgressoExecucao}.tsx`,
`ui/{ConfirmDialog,Toast}.tsx`, rotas `/api/clientes-contabilidade/lote`,
`/api/clientes-contabilidade/faturamentos/lote`, `/api/boletos/lotes*`, `/api/execucoes`,
`server/orchestrator/execucao-orchestrator.ts`, `docs/design-system.md`.

---

## 1. Estado Atual

### 1.1 Dois domínios, um pipeline, duas experiências

| Dimensão | Médico / Empresa | Cliente de contabilidade |
|---|---|---|
| Entrada da emissão | `/execucoes` → "Nova emissão" (`NovaExecucao.tsx`, 3 modos) | Linha da lista → "Emissão" (`EmissaoCliente.tsx`, fork por `modoCobranca`) **ou** seleção múltipla → "Calcular em lote" |
| Campo competência | `<input>` texto + regex + `maxLength={7}` (`NovaExecucao.tsx:441`, `:821`, `:977`) | `<input type="month">` (`LoteContabilidadeDialog.tsx:110`, `GerarExecucao.tsx:69`, `FaturamentoEEmissao.tsx:127`) |
| Guarda anti-duplicidade | `medicosComBoleto` por competência (`NovaExecucao.tsx:176-184`) | **Não existe** |
| Preview antes de calcular | Lista "Prontos para processar / Vínculo manual pendente / Já emitido" (`NovaExecucao.tsx:1030-1174`) | Contagem seca "N clientes" (`LoteContabilidadeDialog.tsx:155-162`) |
| Progresso do cálculo | `ProgressoExecucao` — barra, %, detecção de travamento + "Reprocessar" (`ProgressoExecucao.tsx:57-93`) | Rótulo de botão "Calculando…" (`LoteContabilidadeDialog.tsx:211`) |
| Confirmação antes de emitir 1 boleto | `EmitirBoletoDialog` com a **conta emissora** visível (`RelatorioGrupos.tsx:303-315`, `:333-382`) | 1 clique direto (`GerarExecucao.tsx:161`) |
| Relatório pós-cálculo | `RelatorioGrupos` (4 grupos, revisar, recalcular, reenviar, lote) | O mesmo `RelatorioGrupos`, mas com vocabulário e ações de médico |
| Formatação de dinheiro | `toLocaleString('pt-BR', currency)` | `R$ ${v.toFixed(2)}` em 5 pontos (`DetalheCliente.tsx:143`, `:180`; `FaturamentoEEmissao.tsx:201`; `GerarExecucao.tsx:97`, `:151`) |
| Tabelas | `.data-table` (`HistoricoExecucoes.tsx:255`) | `<table className="w-full text-sm">` à mão (`DetalheCliente.tsx:127`, `:156`; `FaturamentoEEmissao.tsx:180`) |

O que já está **bom** e merece ser preservado como padrão da casa: o desenho do
`LoteEmissaoDialog` (preview síncrono → confirmação única → processamento assíncrono com polling,
pausa por falhas e retomada — `LoteEmissaoDialog.tsx:22-27`, `:203-266`); a decisão de
**nunca chutar valor** (alerta explícito em vez de estimativa —
`execucao-orchestrator.ts:753-765`); e a reutilização real do lote de emissão pelo lote de
contabilidade sem tocar nele (`LoteContabilidadeDialog.tsx:89-97`).

### 1.2 Métricas de sistema de design (estado brownfield)

- **10 cascas de modal duplicadas** em `apps/web/src` (`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4` + `bg-cc-surface card`), com **4** declarando `role="dialog"`/`aria-modal` (`DreManager.tsx:102`, `LinkPublicoBI.tsx:53`, `ExtratoManager.tsx:116` e `:227`) e **6 sem** — exatamente os 6 do caminho de emissão: `ConfirmDialog.tsx:38`, `LoteContabilidadeDialog.tsx:100`, `LoteEmissaoDialog.tsx:107`, `RelatorioGrupos.tsx:347`, `RecebiveisManager.tsx:71`, `SyncModal.tsx:91`.
- **0 modais** com focus trap, foco inicial, retorno de foco ao fechar, Escape ou clique no backdrop. Só `Sidebar.tsx:91` e `CommandPalette.tsx:32` tratam Escape.
- **4 cópias** da função `brl()` (`LoteContabilidadeDialog.tsx:19`, `LoteEmissaoDialog.tsx:9`, `RelatorioGrupos.tsx:14`, `HistoricoExecucoes.tsx:11`) + **3 cópias** de `competenciaAtual()` (`LoteContabilidadeDialog.tsx:22`, `GerarExecucao.tsx:13`, `FaturamentoEEmissao.tsx:11`) + **4 cópias** de `normalizarBusca()`.
- **2 padrões** de campo de competência para o mesmo dado de negócio.
- `NovaExecucao.tsx` = **1.227 linhas**, 3 modos, ~18 estados de seleção num único componente.

---

## 2. Como Funciona a Emissão em Lote Hoje (Contabilidade)

> Mapeamento derivado da leitura do código (não de documentação). Serve para PM/dev validarem
> contra o comportamento real.

### 2.1 Gatilho

1. `/clientes-contabilidade` (`ClientesContabilidadeManager.tsx`) — lista paginada de 20
   (`PAGE_SIZE`, linha 24), com busca por nome (linha 65-68) e checkbox por linha (linha 385-392).
2. Marcando ≥1 cliente, aparece a **barra de seleção** (linha 315-340) com três ações:
   "Limpar seleção", "**Calcular em lote (N)**" e "Excluir selecionados (N)".
3. `N` no botão do lote = **só os clientes ATIVOS** da seleção (`clientesSelecionadosAtivos`,
   linha 199-201) — pode ser menor que o `selecionados.size` mostrado à esquerda (linha 318),
   sem nenhuma explicação da diferença.
4. O clique abre `LoteContabilidadeDialog` recebendo os objetos `ClienteContabilidade` já
   resolvidos (linha 206) — o diálogo **não busca nada** sobre os clientes.

### 2.2 Passo 1 — Competência e (condicional) faturamento em massa

- Competência inicia no mês corrente (`competenciaAtual()`, linha 22-25) via `<input type="month">`
  (linha 109-118); é **travada** depois que o cálculo roda (`disabled={!!execucaoId}`).
- O diálogo particiona a seleção: `faixaFaturamento = clientes.filter(modoCobranca === 'faixa_faturamento')`
  (linha 43). `precisaFaturamento = faixaFaturamento.length > 0 && !faturamentoLancado` (linha 44).
- **Se `precisaFaturamento`**: renderiza um bloco com uma linha por cliente `faixa_faturamento`
  (nome truncado + input numérico, linhas 128-143), num scroll de `max-h-52`, e o único botão
  disponível é "**Lançar faturamentos e continuar**" (linha 144-151). O botão "Calcular" **não
  existe** nesse estado (condição `!execucaoId && !precisaFaturamento`, linha 205).
- O envio (`lancarFaturamentos`, linha 46-62) filtra os campos vazios/inválidos **no cliente**
  (linha 50) e chama `POST /api/clientes-contabilidade/faturamentos/lote`.
- O servidor (`cliente-contabilidade-faturamento-repository.ts:64-80`) faz **upsert por
  `(cliente, competência)`** em loop, isolando falhas: devolve `{ lancados, falhas[] }` — e
  `falhas[]` identifica o cliente **por UUID**, sem nome (`services/clientes-contabilidade.ts:66-69`).
- No `onSuccess` (linha 53-60): `setFaturamentoLancado(true)` **incondicional**, depois um toast
  com a contagem. O bloco de inputs some e o fluxo avança.

### 2.3 Passo 2 — Cálculo do lote

- Botão "Calcular N em lote" → `POST /api/clientes-contabilidade/lote` com
  `{ competencia, clienteContabilidadeIds }` — **todos** os clientes selecionados, `fixo` e
  `faixa_faturamento` juntos.
- A rota (`lote/route.ts`) exige papel `admin|colaborador` (linha 19), aplica rate limit de
  **3 chamadas/minuto por usuário** (linha 13), valida o payload (máx. **200** ids,
  `execucao-schema.ts:93-99`) e chama `iniciarLoteClientesContabilidade` +
  `dispararPrimeiroLote` — **aguardando o cálculo terminar** antes de responder
  (`maxDuration = 300`, linha 16).
- `iniciarLoteClientesContabilidade` (`execucao-orchestrator.ts:422-453`) rejeita ids duplicados
  (`SELECAO_DUPLICADA`), estoura acima de 200 (`LOTE_MUITO_GRANDE`) e valida existência/ativo
  (`SELECAO_INVALIDA` com a lista de motivos). Cria **1 execução** com `clientes_contabilidade_ids`.
- `processarLoteClientesContabilidade` (linha 820-832) roda com concorrência 8
  (`LOTE_CLIENTES_CONTABILIDADE_CONCORRENCIA`), 1 `execucao_resultado` por cliente:
  - `faixa_faturamento`: busca o faturamento da competência; **se não houver**, resultado
    `alerta` com `totalValor = 0` e a mensagem "Faturamento não lançado para a competência
    {AAAA-MM}. Lance antes de gerar o boleto." (linha 753-764).
  - `fixo`: aplica `regraPreco.valorFixo` direto (linha 766-768).
  - **`ehAdicional` é sempre `false`** no lote (linha 845 + comentário linha 817) — o adicional
    semestral nunca entra em lote, por decisão explícita.
  - Falha de infraestrutura em 1 cliente → aquele resultado vira `alerta` com nome "Cliente
    contábil desconhecido" (linha 854-863) e o lote continua.
- A resposta é só `{ execucaoId }`. O diálogo então faz **uma busca única** dos resultados
  (`resultadosQ`, linha 73-77 — sem polling, porque a rota já esperou).

### 2.4 Passo 3 — Revisão dos resultados

- Três contadores: Ok / Alerta / **Total** (linha 170-183). O "Total" soma **todos** os
  resultados, inclusive os em alerta de valor 0 (linha 82) — não é o valor que será emitido.
- Lista de alertas: só `alertas[0]` por cliente (linha 190), sem link, sem ação.
- Botão "**Emitir boletos em lote**" só aparece se `totalOk > 0` (linha 214).

### 2.5 Passo 4 — Emissão em lote (mecanismo compartilhado, sem mudança)

- `setMostrarEmissao(true)` faz o `LoteContabilidadeDialog` **substituir a si mesmo** pelo
  `LoteEmissaoDialog` (linha 89-97) — mesmo `z-50`, sem breadcrumb.
- `LoteEmissaoDialog` monta o preview automaticamente ao abrir (`POST /api/boletos/lotes`,
  `admin|financeiro`), classificando cada item em **pendente** ou **pulado** com código de erro
  traduzido (`CODIGO_ERRO_LABEL`, linha 13-20: cobrança incompleta, valor abaixo do mínimo de
  R$ 5,00, conta sem credenciais, boleto já emitido, sem pagador vinculado, status inválido).
- Confirmação única com snapshot `{ totalItens, totalValor }`; divergência ou expiração
  (`SNAPSHOT_DIVERGENTE`/`LOTE_EXPIRADO`) regenera o preview automaticamente (linha 72-79).
  `POST /api/boletos/lotes/[id]/confirmar` exige **`admin`** (linha 31 da rota).
- Processamento assíncrono com polling de 2s, barra de progresso, e estado
  `pausado_por_falhas` com motivo + "Retomar lote" (linha 232-242). **Fechar o diálogo não
  cancela** um lote confirmado (documentado no JSDoc, linha 26 — não na tela).

### 2.6 Estados possíveis do diálogo (máquina de estados real)

| # | Condição | O que a tela mostra | Ações disponíveis |
|---|---|---|---|
| S0 | `!execucaoId && precisaFaturamento` | Inputs de faturamento dos clientes `faixa` | Lançar faturamentos · Cancelar |
| S1 | `!execucaoId && !precisaFaturamento` | "Pronto pra calcular N clientes" | Calcular em lote · Cancelar |
| S2 | `calcular.isPending` | Botão "Calculando…" (nada mais muda) | — (até 300s) |
| S3 | `execucaoId && resultadosQ.isLoading` | "Carregando resultado do lote…" | Fechar |
| S4 | `execucaoId && totalOk > 0` | Contadores + lista de alertas | Emitir boletos em lote · Fechar |
| S5 | `execucaoId && totalOk === 0` | Contadores (0 ok) + alertas | **Só Fechar** — beco sem saída |
| S6 | `mostrarEmissao` | `LoteEmissaoDialog` (preview → confirmação → progresso) | Confirmar · Fechar (volta a S4) |

**Não existem** os estados: erro no carregamento dos resultados (S3 falha → cai em S5 mostrando
"0 ok, 0 alerta, R$ 0,00" sem mensagem), lançamento parcialmente falho (S0 → S1 sempre), e
"lote já emitido nesta competência".

### 2.7 Casos de borda — comportamento real

| Caso | Comportamento hoje | Avaliação |
|---|---|---|
| Faturamento não lançado para 1 cliente | Entra no lote, vira `alerta` com valor 0 e mensagem explícita | ✅ correto no motor, ❌ sem saída na UI (§3, G-10/G-22) |
| **Todos** os lançamentos falham | `faturamentoLancado = true` mesmo assim → avança para S1 → todos viram alerta | ❌ **bug de fluxo** |
| Mistura `fixo` + `faixa_faturamento` | Funciona; os `fixo` são calculados sem input | ✅ funciona, ❌ não é comunicado (§3, G-14) |
| Competência alterada **antes** de lançar | `setFaturamentoLancado(false)` (linha 114) mas os **valores digitados permanecem** | ❌ risco de lançar o faturamento de um mês em outro |
| Competência alterada **depois** do cálculo | Campo travado (`disabled={!!execucaoId}`) | ✅ correto |
| Mesmo lote rodado 2x na mesma competência | Cria 2 execuções → 2 resultados → **2 boletos** (idempotência é por `execucao_resultado_id`) | ❌ **risco financeiro** (§5, R-1) |
| Cliente inativo na seleção | Descartado silenciosamente no cliente; servidor também barraria (`SELECAO_INVALIDA`) | ⚠️ silencioso |
| Adicional semestral no ciclo | **Nunca** entra no lote; nenhum aviso | ❌ operador precisa saber por fora |
| >200 clientes | 422 `LOTE_MUITO_GRANDE` → toast genérico | ❌ limite invisível antes do erro |
| 4ª chamada em 1 minuto | 429 do rate limiter → toast | ❌ sem orientação de quando tentar de novo |
| Rede cai durante o cálculo (até 300s) | `onError` → toast; o lote **pode ter sido criado** no servidor | ❌ sem "recuperar execução em andamento" |

---

## 3. Gaps Identificados

### 3.1 Bloqueadores de fluxo (lote de contabilidade)

**G-01 — Lançamento em massa marca sucesso mesmo quando 100% falha.**
`LoteContabilidadeDialog.tsx:53-60` — `setFaturamentoLancado(true)` roda antes de olhar
`resultado.falhas`. Com 12 de 12 falhas, o passo 1 desaparece e a tela diz "Pronto pra calcular
12 clientes". O cálculo então produz 12 alertas.

**G-02 — As falhas nunca são renderizadas e não são identificáveis.**
Só um toast de contagem (`:56`), que some em 4,2s (`Toast.tsx:52`). E o payload de falha traz
`clienteContabilidadeId` (UUID) sem nome (`services/clientes-contabilidade.ts:66-69`) — mesmo se
fosse renderizado, não seria acionável. Compare com o padrão já correto de importação de
planilha, que lista linha + chave + erro (`ClientesContabilidadeManager.tsx:278-286`).

**G-03 — Sem retry dos faturamentos que falharam.**
Uma vez `faturamentoLancado = true`, a condição `!execucaoId && precisaFaturamento` (`:121`)
nunca mais é verdadeira. Não há "voltar ao passo 1". A única saída é fechar e recomeçar.

**G-04 — Trocar a competência não limpa os valores digitados.**
`:112-115` reseta `faturamentoLancado` mas mantém `faturamentos`. O operador que digita 40
valores para 2026-07, percebe o engano e troca para 2026-08 lança, sem aviso, os números de
julho na competência de agosto.

**G-05 — Papéis incompatíveis dentro do mesmo diálogo (achado crítico).**
As três etapas exigem conjuntos de permissão **diferentes e não sobrepostos**:
| Etapa | Rota | Papéis |
|---|---|---|
| Lançar faturamento em massa | `faturamentos/lote/route.ts:12` | `admin, colaborador, financeiro` |
| Calcular o lote | `lote/route.ts:19` | `admin, colaborador` |
| Montar preview de emissão | `boletos/lotes/route.ts:23` | `admin, financeiro` |
| **Confirmar** a emissão | `boletos/lotes/[id]/confirmar/route.ts:31` | **`admin`** |

Resultado: **nenhum papel além de `admin` completa o fluxo de ponta a ponta**. Um `colaborador`
faz os passos 1 e 2 e toma 403 na emissão; um `financeiro` toma 403 já no passo 2. A UI mostra
todos os botões habilitados para todos — a descoberta é por erro. O mesmo vale para o lote de
médico em `RelatorioGrupos.tsx:273`.

**G-06 — Zero indicação de progresso durante o cálculo (até 300s).**
`:207-212` — o único feedback é o rótulo do botão virar "Calculando…". Sem barra, sem contagem,
sem `aria-live`, sem estimativa, sem detecção de travamento. O padrão correto já existe na casa
em dois lugares (`ProgressoExecucao.tsx:57-93` com barra + % + "Reprocessar" após 6min;
`LoteEmissaoDialog.tsx:218-230` com barra + %) e não foi aplicado.

**G-07 — Sem tratamento de erro no carregamento dos resultados.**
`:73-79` não usa `isError`. Falha de rede → `resultados = []` → "Ok 0 / Alerta 0 / R$ 0,00" e o
botão de emitir some (S5). O usuário conclui que o lote não calculou nada.

**G-08 — O "Total" exibido não é o valor que será cobrado.**
`:82` soma todos os resultados; só os `ok` viram boleto. Num lote com 30 alertas de valor 0 o
número coincide por acaso — mas num lote com alertas de valor calculado (falha de infra
recalculada, cliente com regra incoerente) o total infla.

**G-09 — Sem guarda de duplicidade por competência.**
Não há equivalente de `medicosComBoleto` (`NovaExecucao.tsx:176-184`,
`services/execucoes.ts:118`), que nasceu de um achado real da coordenadora financeira em
2026-08-04 exatamente para esse risco. Como a idempotência do gateway é por
`execucao_resultado_id`, rodar o mesmo lote duas vezes gera dois boletos para o mesmo
cliente/competência.

**G-10 — Alertas não são acionáveis.**
`:184-194` mostra `<strong>{nome}</strong>: {alertas[0]}` — sem link para o cliente, sem "lançar
faturamento agora", sem "recalcular", sem copiar a lista. Para um alerta cuja causa é
literalmente "lance o faturamento antes", o próprio diálogo tinha o campo dois passos atrás.

**G-11 — Adicional semestral invisível no lote.**
`execucao-orchestrator.ts:817,845` decide (corretamente) não incluir o adicional. Mas o diálogo
não avisa, e `cicloAdicionalVencendoNaCompetencia` — que já existe e já é usada em
`GerarExecucao.tsx:33` — não é consultada no lote. Um cliente com ciclo vencendo em 2026-08
passa batido.

**G-12 — Composição do lote não é comunicada.**
`:155-162` mostra "Pronto pra calcular N clientes". Não diz quantos são `fixo` (não precisam de
faturamento), quantos são `faixa` com faturamento **já lançado** em sessão anterior, quantos
ficaram em branco. O texto do bloco de faturamento (`:123-127`) até menciona a regra, mas em
`text-sm text-cc-ink-2` dentro de um bloco que some assim que o passo 1 termina.

**G-13 — Limites do sistema invisíveis.** Máximo de 200 por lote (`execucao-schema.ts:98`) e
rate limit de 3/min (`lote/route.ts:13`) só aparecem como erro depois do clique.

**G-14 — Sem busca/ordenação/ações em massa na lista de faturamento.**
`:128-143` — até 200 linhas de input num scroll de `max-h-52` (≈13rem, ~4 linhas visíveis), sem
busca, sem "preencher todos com o mesmo valor", sem contagem "X de Y preenchidos", sem
persistência de rascunho (fechar o diálogo perde tudo).

**G-15 — Contagens divergentes na barra de seleção.**
`ClientesContabilidadeManager.tsx:318` mostra `selecionados.size`; `:330` mostra
`clientesSelecionadosAtivos.length`. Selecionar 10 clientes com 3 inativos exibe
"10 selecionados" ao lado de "Calcular em lote (7)" sem explicação.

### 3.2 Emissão individual de contabilidade

**G-16 — Erro de infraestrutura comunicado como erro de dados.**
`EmissaoCliente.tsx:22-23` e `DetalheCliente.tsx:64-65` não têm ramo `isError`: qualquer falha de
rede renderiza "Cliente contábil não encontrado." — o operador conclui que o cadastro sumiu.

**G-17 — Cliente `faixa_faturamento` com adicional ativo não tem caminho na UI.**
`EmissaoCliente.tsx:25-27` roteia `faixa_faturamento` → `FaturamentoEEmissao`, que dispara com
`ehAdicional` fixo em `false` (`FaturamentoEEmissao.tsx:76`). O toggle do adicional só existe em
`GerarExecucao.tsx:87-107` (modo `fixo`). Mas o cadastro permite `adicionalAtivo` em qualquer
modo (`ClienteContabilidadeForm.tsx:123-125`, `:244-249`) e a arquitetura trata o adicional como
exceção pontual, não como característica do modo
(`feature-emissao-contabilidade.md` §0.3, §D4). **Gap funcional, não só de UX.**

**G-18 — O dado mais importante da operação vive num toast de 4,2s.**
`FaturamentoEEmissao.tsx:62-66` entrega o **valor calculado** (`resp.preview.valor`) e os
**alertas da regra de preço** exclusivamente por toast. Some antes de o operador conferir.

**G-19 — Relançar faturamento é upsert silencioso.**
`cliente-contabilidade-faturamento-repository.ts:30-39` usa `onConflict` — sobrescreve o valor
anterior sem confirmação. A UI (`FaturamentoEEmissao.tsx:148`) não avisa "já existe R$ X lançado
para esta competência".

**G-20 — `podeAvancarParaEmissao` não mostra o que já está lançado.**
`:49-50`, `:156-161` — libera o passo 2 dizendo "Faturamento de 2026-08 lançado", sem exibir o
valor lançado nem o valor calculado. O operador precisa procurar na tabela do rodapé (`:198-205`).

**G-21 — `Acompanhamento` sem saída para o estado `alerta`.**
`GerarExecucao.tsx:145-165` mostra o badge e a lista de alertas, mas **nenhuma ação**: não há
revisar, não há recalcular, não há lançar faturamento. O único caminho é abandonar a tela e ir
para `/execucoes/[id]`.

**G-22 — Emissão de contabilidade tem 1 clique; a de médico tem confirmação com conta emissora.**
`GerarExecucao.tsx:160-164` emite direto. O fluxo médico exige o `EmitirBoletoDialog`
(`RelatorioGrupos.tsx:303-315`), cujo próprio comentário chama a conta emissora de "última
barreira contra emissão pela conta errada" (`:119-121`). Clientes contábeis também têm
`contaEmissora` no cadastro — e não veem essa barreira.

**G-23 — Sem estado de carregamento no `Acompanhamento`.**
`:141-144` — enquanto o realtime não responde, o card fica visualmente vazio.

**G-24 — Aviso usa o tom de erro.**
`DetalheCliente.tsx:116-121` usa `alert-error` (vermelho, `role="alert"`) para o reajuste anual
pendente, que é aviso. `design-system.md` §Componentes utilitários define `.alert-warning`.

**G-25 — Avisos de carteira não existem em nível de lista.**
`feature-emissao-contabilidade.md` §D5 previa um aviso em jan/fev listando os clientes `fixo` sem
reajuste. Hoje `reajusteAnualPendente` só é avaliado dentro do detalhe de um cliente por vez
(`DetalheCliente.tsx:67-70`), e o ciclo do adicional só dentro de `GerarExecucao.tsx:29-33`.
Ninguém vê a carteira inteira.

**G-26 — Tabelas fora do design system.**
`DetalheCliente.tsx:127`, `:156` e `FaturamentoEEmissao.tsx:180` reimplementam a tabela em vez de
usar `.data-table`, que `design-system.md` define e `HistoricoExecucoes.tsx:255` usa.

**G-27 — Moeda sem formatação pt-BR.**
`DetalheCliente.tsx:143`, `:180`; `FaturamentoEEmissao.tsx:201`; `GerarExecucao.tsx:97`, `:151`
usam `R$ ${v.toFixed(2)}` → a tela mostra "R$ 1480.56" onde o resto do sistema mostra
"R$ 1.480,56".

### 3.3 Fluxo de médico/empresa

**G-28 — Dois padrões de campo de competência** (`NovaExecucao.tsx:441`, `:821`, `:977` texto +
regex vs. `type="month"` em contabilidade). Além da inconsistência, o campo de texto aceita
"2026-13" até o `disabled` silencioso do botão.

**G-29 — Botão desabilitado sem explicação.**
`NovaExecucao.tsx:991-997` — "Processar 0 médicos" desabilitado quando a competência está vazia,
sem dizer o que falta. Mesmo problema em `:454-462` (empresa): o rótulo mostra "(2/7 médicos)"
mas não comunica que a regra é **tudo ou nada** (`canDispararEmpresa`, `:373-378`).

**G-30 — Regra que muda o valor cobrado escondida em micro-copy de baixo contraste.**
`NovaExecucao.tsx:742-744` explica, em `text-xs text-cc-muted`, que escolher um sub-lote de
consultas **transforma os demais sub-lotes em guia principal**. É a regra de maior impacto
financeiro da tela, no menor e menos contrastado texto dela. O mesmo `<select>` mistura dois
namespaces de id (sub-lotes de `fin-lotes` e produções flat), separados só pelo rótulo do
`optgroup` (`:725-740`, `:794-802`). *(Área do trabalho não commitado de sub-lotes — sinalizado,
não alterado.)*

**G-31 — "Recalcular" não existe para empresa nem para cliente contábil.**
`RelatorioGrupos.tsx:501-503` condiciona a `r.medicoId`. Ironicamente, o caso de contabilidade é
o mais óbvio: o alerta "faturamento não lançado" é resolvido lançando o faturamento — e depois
não há como refazer a conta sem criar uma execução nova.

**G-32 — "Revisar e liberar" não mostra o valor que está sendo liberado.**
`AcaoRevisar` (`:566-620`) pede só o motivo. Um cliente contábil em alerta por faturamento não
lançado tem `totalValor = 0` (`execucao-orchestrator.ts:758-762`) e `revisarResultado`
(`execucao-repository.ts:409-427`) **não valida valor** — o item vira "Pronto para emissão" com
R$ 0,00. O gateway barra depois (mínimo R$ 5,00 → `VALOR_ABAIXO_MINIMO`), mas a UI já afirmou
que estava pronto.

**G-33 — Ação em lote com menos peso visual que a individual.**
`RelatorioGrupos.tsx:273` usa `btn-secondary` para "Emitir todos os pendentes", enquanto o botão
individual (`:545`) é `btn-primary`. A ação de maior alcance é a menos evidente.

**G-34 — Vocabulário 100% médico numa tela agora compartilhada.**
`RelatorioGrupos.tsx:246` "Buscar médico por nome...", `:439` "Nenhum médico neste grupo",
`:229` filtra `r.nome`; `ProgressoExecucao.tsx:62` "Processando médicos". O lote de contabilidade
desemboca exatamente aqui (`/execucoes/[id]`).

**G-35 — Histórico não representa contabilidade.**
`HistoricoExecucoes.tsx:45` classifica por `totalMedicos === 1` → um lote de contabilidade (0
médicos) vira "Em massa" e uma execução singular de cliente contábil também. `:273-275` só sabe
exibir `medicoNome`, então execuções de contabilidade aparecem **sem identidade**. A busca
(`:72-74`) cobre competência e médico — não há como achar a execução de um cliente contábil pelo
nome.

**G-36 — Navegação: a emissão de contabilidade mora na vertical médica.**
`Sidebar.tsx:28` põe "Emissão" só em *Cobrança Médica*; a seção *Contabilidade* (`:33-39`) não
tem entrada de emissões. O relatório de um lote contábil abre em `/execucoes/[id]`, do outro lado
da divisória que o próprio dono pediu em 2026-07-24.

### 3.4 Acessibilidade (transversal, WCAG AA)

**G-37 — Os 6 modais do caminho de emissão não são modais para tecnologia assistiva.**
Sem `role="dialog"`, `aria-modal`, `aria-labelledby`: `ConfirmDialog.tsx:38`,
`LoteContabilidadeDialog.tsx:100`, `LoteEmissaoDialog.tsx:107`, `RelatorioGrupos.tsx:347`,
`RecebiveisManager.tsx:71`, `SyncModal.tsx:91`. O padrão correto **já existe** no mesmo repo
(`ExtratoManager.tsx:116`, `DreManager.tsx:102`, `LinkPublicoBI.tsx:53`).

**G-38 — Nenhum modal tem focus trap, foco inicial, retorno de foco, Escape ou backdrop
clicável.** Abrir "Calcular em lote" deixa o foco no botão da página atrás do overlay; Tab
percorre a tabela por baixo do modal. Viola WCAG 2.4.3 (Focus Order) e 2.1.2 (No Keyboard Trap —
aqui, o inverso: ausência de contenção).

**G-39 — Modal dentro de modal sem anúncio.**
`LoteContabilidadeDialog.tsx:89-97` substitui o próprio conteúdo pelo `LoteEmissaoDialog` no mesmo
`z-50`. Para leitor de tela nada é anunciado; visualmente o título muda de "Calcular em lote — 12
clientes" para "Emitir boletos em lote" sem indicar que é o mesmo lote, nem qual competência.

**G-40 — Toast: erros anunciados como `status`, e auto-dismiss sem pausa.**
`Toast.tsx:71` usa `role="status"` (polite) para todos os tipos, inclusive `error` — deveria ser
`role="alert"` (assertive). `:51-54` fecha em 4,2s sem pausar no hover/foco — WCAG 2.2.1
(Timing Adjustable). É justamente por onde passam as mensagens de falha de lançamento em massa
(G-02).

**G-41 — Bug visual no toast.** `Toast.tsx:72` não tem `relative`, então a barra de acento
`absolute left-0 top-0 h-full` (`:89`) se ancora no contêiner `fixed` (`:41`) e escapa do
`overflow-hidden` — desenha uma faixa vertical à esquerda de toda a pilha, não do card.

**G-42 — Estados de carregamento sem `aria-live`.**
`LoteContabilidadeDialog.tsx:167`, `LoteEmissaoDialog.tsx:114` e `:216`, `EmissaoCliente.tsx:22`,
`DetalheCliente.tsx:64`, `GerarExecucao.tsx:142` são parágrafos mudos. O padrão certo existe em
`ProgressoExecucao.tsx:58` e `:103` (`role="status" aria-live="polite"`).

**G-43 — Inputs de faturamento sem rótulo programático.**
`LoteContabilidadeDialog.tsx:130-140` — o nome do cliente é um `<span>` irmão, não um
`<label htmlFor>` nem `aria-label`. O leitor de tela anuncia "campo numérico, 0.00" 40 vezes
seguidas, sem saber de quem. O mesmo componente faz certo em outros lugares
(`ClientesContabilidadeManager.tsx:391` usa `aria-label`).

**G-44 — Contraste abaixo de AA em texto informativo.**
`cc-muted` (#71717A) sobre `cc-surface` (#171717) = **3,70:1** — abaixo de 4,5:1 exigido para
texto normal, e usado em conteúdo real, não decorativo: `LoteContabilidadeDialog.tsx:167`
("Carregando resultado do lote…"), `:172` (rótulos dos contadores, em `text-2xs` ≈11px),
`GerarExecucao.tsx:102`, `FaturamentoEEmissao.tsx:110`, `NovaExecucao.tsx:742`, `:1028`.
(`cc-ink-2` #A1A1AA fica em 6,98:1 — está OK.)

**G-45 — Linha de tabela clicável inacessível por teclado.**
`ClientesContabilidadeManager.tsx:378-383`, `HistoricoExecucoes.tsx:270`,
`HistoricoExecucoesPorMedico.tsx:189` usam `onClick` no `<tr>` com `cursor-pointer`, sem
`tabIndex`/`onKeyDown`. Mitigado (não resolvido) pelos links "Abrir"/"Emissão" na coluna de ação.

### 3.5 Responsividade

**G-46 — Scroll aninhado em três níveis** no diálogo de lote: corpo `max-h-[65vh]`
(`LoteContabilidadeDialog.tsx:106`) → lista de faturamento `max-h-52` (`:128`) → lista de alertas
`max-h-40` (`:185`). Em telas baixas o operador rola dentro de rolagem dentro de rolagem.

**G-47 — Contadores em 3 colunas fixas sem breakpoint.**
`:170` (`grid-cols-3`) e `LoteEmissaoDialog.tsx:244` — em 320px cada célula fica ~90px e
"R$ 1.480,56" em `tabular` estoura ou quebra.

**G-48 — Linha de faturamento espremida no mobile.**
`:130-140` — `flex` com input `w-32` fixo deixa ~45% da largura para o nome (`truncate`). Numa
carteira com "Vital Soluções Empresariais LTDA" e "Vital Soluções Contábeis LTDA", os dois
truncam igual.

**G-49 — Barra de seleção sem wrap.**
`ClientesContabilidadeManager.tsx:315-338` — `justify-between` com 3 botões (`:320` sem
`flex-wrap`); em mobile "Calcular em lote (7)" e "Excluir selecionados (10)" se comprimem.

**G-50 — Seletor de modo sem wrap.** `NovaExecucao.tsx:386-405` — `inline-flex` com 3 botões.

**G-51 — Tabela de clientes com 7 colunas.** `overflow-x-auto` está presente (conforme
`design-system.md`), mas a coluna de ações fica fora da viewport no mobile sem nenhuma affordance
de "role para o lado".

---

## 4. Recomendações de UX e Fluxo

Priorização por **impacto × esforço**. "Impacto" pondera risco financeiro e frequência de uso.

### 4.1 Prioridade ALTA

**R-1 · Guarda de duplicidade para clientes contábeis** — *(G-09; risco financeiro direto)*
Criar `GET /api/clientes-contabilidade/com-boleto?competencia=AAAA-MM` espelhando
`execucoes/medicos-com-boleto`, e no diálogo separar visualmente um bloco "**Já emitido nesta
competência (N)**" — mesmo tratamento que `NovaExecucao.tsx:1123-1140` já dá para médicos,
incluindo remover esses clientes do payload. *Esforço: M · Impacto: alto.*

**R-2 · Fechar o loop do lançamento em massa** — *(G-01, G-02, G-03, G-04)*
(a) Só avançar quando `lancados > 0`; (b) renderizar as falhas **por nome** num bloco persistente
(padrão de `ClientesContabilidadeManager.tsx:278-286`), o que exige o backend devolver `nome` em
`falhas[]`; (c) botão "Tentar de novo (N que falharam)" que remonta o passo 1 só com os
pendentes; (d) ao trocar a competência, ou limpar os valores digitados ou pedir confirmação
explícita ("manter os 12 valores digitados para 2026-08?"). *Esforço: B/M · Impacto: alto.*

**R-3 · Progresso real no cálculo em lote** — *(G-06)*
Reaproveitar `ProgressoExecucao` + `useExecucaoRealtime` dentro do diálogo, com `role="status"`.
Se manter o desenho síncrono, no mínimo: contador "calculando X de N", `aria-live`, e um aviso de
travamento após ~2min com ação de recuperação. Sub-produto: resolve também "rede caiu no meio",
porque o `execucaoId` passa a ser recuperável. *Esforço: M · Impacto: alto.*

**R-4 · Painel de composição do lote antes de calcular** — *(G-08, G-11, G-12, G-13, G-15)*
Substituir "Pronto pra calcular N clientes" por um resumo estruturado:
`X em faixa de faturamento (Y com faturamento lançado · Z pendentes) · W em valor fixo ·
V com adicional semestral vencendo em {competência} — não incluído neste lote, gere
individualmente · L inativos removidos da seleção`, mais o teto de 200 quando aplicável. E depois
do cálculo, trocar o card "Total" por "**A emitir** (só os ok)" com "Total geral" como linha
secundária. *Esforço: M · Impacto: alto.*

**R-5 · Componente `<Modal>` único e acessível** — *(G-37, G-38, G-39, e 10 cascas duplicadas)*
Extrair um organismo com `role="dialog"`, `aria-modal`, `aria-labelledby`, foco inicial no
primeiro elemento interativo, focus trap, retorno de foco ao gatilho, Escape e clique no
backdrop (com bloqueio quando há operação em voo). Migrar primeiro os 6 do caminho de emissão.
Métrica: **10 cascas → 1 componente**; **4/10 → 10/10** com semântica de diálogo. Para o
modal-dentro-de-modal, adicionar breadcrumb no título ("Lote 2026-08 · Emitir boletos") e um
"← Voltar ao lote" ao lado de "Fechar". *Esforço: M · Impacto: alto (a11y + consistência).*

**R-6 · Deixar as permissões visíveis antes do clique** — *(G-05)*
Duas frentes: (i) **decisão de produto** — alinhar os papéis para que exista pelo menos um perfil
não-admin capaz de operar o fluxo inteiro; (ii) **UX** — o diálogo deve conhecer o papel da
sessão e, quando o usuário não puder concluir, avisar **no início** ("você pode lançar o
faturamento e calcular; a emissão precisa de um admin") em vez de deixá-lo descobrir com um 403
no último passo. *Esforço: M · Impacto: alto.*

**R-7 · Confirmação de emissão consistente entre domínios** — *(G-22)*
`GerarExecucao.Acompanhamento` deve usar a mesma confirmação com **conta emissora** do fluxo de
médico. O ideal é extrair `EmitirBoletoDialog` de `RelatorioGrupos.tsx` para
`components/boletos/` e usá-lo nos dois. *Esforço: B · Impacto: alto.*

**R-8 · Separar "erro" de "vazio" em todos os pontos de carga** — *(G-07, G-16)*
`isError` explícito com mensagem específica e botão "Tentar novamente" em
`LoteContabilidadeDialog.tsx:73`, `EmissaoCliente.tsx:22`, `DetalheCliente.tsx:64`.
*Esforço: B · Impacto: alto (evita diagnóstico errado do operador).*

### 4.2 Prioridade MÉDIA

**R-9 · Alertas acionáveis no relatório** — *(G-10, G-21, G-31)*
No resultado em alerta de cliente contábil: link "Abrir cliente", ação inline "Lançar faturamento
de {competência}" e "**Recalcular**" (estender `onRecalcular` de `RelatorioGrupos.tsx:501` para
`clienteContabilidadeId` e `empresaId`). Fecha o ciclo alerta → correção → recálculo sem refazer
o lote inteiro.

**R-10 · Neutralizar o vocabulário do relatório de emissão** — *(G-34, G-35)*
"Pagador" no lugar de "médico" em `RelatorioGrupos` e `ProgressoExecucao`; badge de tipo
(Médico · Empresa · Cliente contábil) na linha do resultado; coluna/filtro "Tipo" e busca por
nome de pagador em `HistoricoExecucoes`; e revisar `tipoDaExecucao` (`HistoricoExecucoes.tsx:45`)
para classificar por origem real da execução, não por `totalMedicos === 1`.

**R-11 · Adicional semestral acessível nos dois modos** — *(G-17)*
Mover o bloco do adicional de `GerarExecucao` para `EmissaoCliente` (acima do fork), ou replicá-lo
em `FaturamentoEEmissao`. Requer confirmação de regra de negócio (§5).

**R-12 · Moléculas compartilhadas** — *(G-27, G-28, e as 4+3+4 duplicações)*
`<CampoCompetencia>` (`type="month"`, um só padrão nos 6 pontos), `lib/formato.ts` com `brl()` /
`competenciaAtual()` / `normalizarBusca()`. Ganho: 11 duplicações → 4 utilitários, e "R$ 1480.56"
deixa de existir.

**R-13 · Busca e ações em massa dentro do passo de faturamento** — *(G-14)*
Campo de busca, contador "X de Y preenchidos", "aplicar valor a todos os vazios", ordenação por
"pendentes primeiro", e altura da lista responsiva (`max-h-52` → `max-h-[40vh]`). Considerar
rascunho em `localStorage` por competência.

**R-14 · Toast como canal secundário, nunca único** — *(G-18, G-40, G-41)*
`role="alert"` para `kind='error'`; pausar o timer no hover/foco; mensagens compostas (listas de
falha) fora do toast; e o valor calculado do faturamento persistido na tela, não só no toast.
Corrigir o `relative` faltante.

**R-15 · Confirmação em operações irreversíveis silenciosas** — *(G-19, G-32)*
Confirmar sobrescrita de faturamento já lançado; e exibir o valor no formulário "Revisar e
liberar", com aviso destacado quando `totalValor === 0` ("este resultado será liberado com R$
0,00 — o gateway recusa valores abaixo de R$ 5,00").

**R-16 · Peso visual coerente com o alcance da ação** — *(G-33)*
"Emitir todos os pendentes" como `btn-primary`; emissão individual como `btn-secondary`.

**R-17 · `aria-live` e rótulos nos estados assíncronos** — *(G-42, G-43)*
`role="status"` nos 6 pontos de carregamento listados; `<label htmlFor>` ou `aria-label` com o
nome do cliente nos inputs de faturamento.

### 4.3 Prioridade BAIXA

**R-18 · Alinhar as telas de contabilidade ao design system** — *(G-24, G-26)*
`.data-table` nas 3 tabelas; `.alert-warning` no aviso de reajuste.

**R-19 · Responsividade** — *(G-46 a G-51)*
`grid-cols-1 sm:grid-cols-3` nos contadores; `flex-wrap` na barra de seleção e no seletor de
modo; linha de faturamento em 2 linhas abaixo de `sm`; achatar o scroll aninhado do diálogo.

**R-20 · Linhas de tabela navegáveis por teclado** — *(G-45)*
`tabIndex={0}` + `onKeyDown` (Enter/Space) + `role="button"` na `<tr>`, ou mover o clique para o
nome como `<Link>` e remover o `onClick` da linha (preferível — menos ARIA, mais HTML).

**R-21 · Avisos de carteira em nível de lista** — *(G-25)*
Badges "Reajuste pendente" / "Adicional vencendo" na tabela de `/clientes-contabilidade`, com
filtro rápido — entrega o que `feature-emissao-contabilidade.md` §D5 previa como mitigação do
"esquecer o reajuste".

**R-22 · Contraste do token `cc-muted`** — *(G-44)* — **requer aprovação do dono**
Duas saídas: (a) promover o texto informativo de `cc-muted` para `cc-ink-2` nos pontos citados
(zero mudança de token); ou (b) clarear `--text-muted` no dark de `#71717A` para ~`#8A8A93`
(≥4,5:1). (a) é cirúrgico; (b) corrige o sistema inteiro mas re-skina toda a UI.
**Não alterar tokens sem decisão explícita.**

**R-23 · Navegação da vertical contábil** — *(G-36)*
Entrada "Emissões" na seção *Contabilidade* da Sidebar apontando para o histórico filtrado por
tipo de pagador (depende de R-10).

### 4.4 Convergência dos dois lotes (visão de sistema)

Hoje há **dois desenhos de lote** com filosofias opostas: o de emissão
(preview → confirmar → assíncrono com progresso e retomada) e o de cálculo contábil
(faturamento → calcular síncrono e mudo → resultado). O de emissão é claramente o mais maduro —
e já é compartilhado. A recomendação de arquitetura de UX é **um único padrão de "operação em
lote"** aplicado aos três casos (cálculo de médicos, cálculo de contábeis, emissão de boletos):

```
1. Seleção          → contagem + composição + exclusões explicadas
2. Pré-requisitos   → passo condicional (faturamento) com retry por item
3. Preview          → o que vai acontecer, o que será pulado e por quê, total real
4. Confirmação      → uma vez, com snapshot
5. Progresso        → barra + %, aria-live, pausa/retomada, "fechar não cancela"
6. Resultado        → ok/pulado/falha com motivo acionável e caminho de correção
```

O lote de contabilidade hoje cobre 1 (parcial), 2 (parcial) e 6 (parcial); pula 3, 4 e 5. O de
emissão cobre 3, 4, 5 e 6. Unificar reduz o custo de aprendizado do operador — que é **a mesma
pessoa** nos dois domínios.

---

## 5. Riscos e Perguntas em Aberto

### 5.1 Riscos

| # | Risco | Evidência | Severidade |
|---|---|---|---|
| **RS-1** | **Boleto duplicado para cliente contábil.** Rodar o mesmo lote/competência 2x cria 2 execuções → 2 resultados → 2 boletos. A idempotência é por `execucao_resultado_id`, não por (pagador, competência). | `execucao-orchestrator.ts:820-832`; ausência de equivalente a `NovaExecucao.tsx:176-184` | **Alta** (financeiro/reputacional) |
| **RS-2** | **Liberação de resultado com valor zero.** "Revisar e liberar" não valida valor; um alerta de "faturamento não lançado" (`totalValor = 0`) vira "Pronto para emissão". | `execucao-repository.ts:409-427`; `RelatorioGrupos.tsx:566-620` | Média (barrado no gateway, mas engana a UI) |
| **RS-3** | **Lançamento em massa na competência errada.** Valores digitados sobrevivem à troca de competência e o upsert sobrescreve sem aviso. | `LoteContabilidadeDialog.tsx:112-115`; `cliente-contabilidade-faturamento-repository.ts:30-39` | Média |
| **RS-4** | **Operação impossível para não-admins.** Nenhum papel além de `admin` completa o fluxo de lote de ponta a ponta; a UI não sinaliza. | tabela em G-05 | Média (bloqueia adoção) |
| **RS-5** | **Mudanças no `LoteEmissaoDialog` afetam 3 fluxos.** É consumido pelo relatório de execuções e pelo lote de contabilidade. Qualquer melhoria precisa de regressão nos dois domínios. | `RelatorioGrupos.tsx:317-323`; `LoteContabilidadeDialog.tsx:89-97` | Média |
| **RS-6** | **Perda silenciosa de trabalho.** Fechar o diálogo descarta os valores de faturamento digitados; o `execucaoId` de um lote calculado não é recuperável se a aba fechar antes da emissão. | `LoteContabilidadeDialog.tsx:38-41` (estado local) | Baixa/Média |
| **RS-7** | **Mudar `cc-muted` re-skina toda a UI.** `design-system.md` documenta que o mapeamento de tokens propaga globalmente. | `design-system.md` §Arquitetura de tokens | Baixa (contido se optar por R-22a) |
| **RS-8** | **Sobreposição com o trabalho não commitado de sub-lotes de pediatria.** As melhorias em `NovaExecucao` (R-10, R-12) tocam o mesmo arquivo em edição. | `git status` (7 arquivos modificados + migration `0053`) | Baixa (sequenciamento) |

### 5.2 Perguntas em aberto (para o dono / @pm)

1. **Reemissão intencional existe?** Antes de bloquear duplicidade em contabilidade (R-1) é
   preciso saber se há caso legítimo de dois boletos para o mesmo cliente na mesma competência
   (ex.: complemento, correção após cancelamento) — e se sim, como distingui-lo de erro.
2. **O adicional semestral deve entrar em lote?** Hoje é decisão explícita de código que não
   (`execucao-orchestrator.ts:817`). Com carteira crescendo, revisitar — ou pelo menos avisar
   quem está vencendo (R-4).
3. **Cliente `faixa_faturamento` pode ter adicional semestral?** O cadastro permite, a UI não
   entrega (G-17). É gap de implementação ou regra de negócio implícita ("adicional só para
   `fixo`")? Se for regra, o cadastro deveria bloquear.
4. **Qual o tamanho real da carteira contábil?** O teto do lote é 200. Se hoje são ~30 clientes,
   R-13 (busca dentro do diálogo) cai para prioridade baixa; se são 150+, sobe para alta.
5. **Quem opera o lote no dia a dia?** A resposta define R-6: se é sempre o dono (`admin`), o gap
   de papéis é teórico; se a intenção é delegar a `colaborador`/`financeiro`, é bloqueador.
6. **`fixo` e `faixa_faturamento` devem ser calculados no mesmo lote?** Funciona hoje, mas são
   duas rotinas mentais diferentes (uma exige coletar dados do cliente, a outra não). Separar em
   dois lotes pode ser mais limpo que explicar a mistura.
7. **A emissão de contabilidade deve viver em `/execucoes` ou ter tela própria?** A decisão de
   2026-07-24 separou as verticais na navegação, mas o relatório da emissão contábil abre dentro
   da vertical médica (G-36). Manter compartilhado + neutralizar vocabulário (R-10) é o caminho
   de menor custo; tela dedicada é o de maior clareza.
8. **Existe meta de conformidade WCAG?** As recomendações de a11y foram calibradas em **AA**. Se
   a meta for só "não quebrar teclado", R-5 pode ser reduzido a foco + Escape, sem o pacote ARIA
   completo.

---

## 6. Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-08-25 | 0.1 | Auditoria inicial de UX da área de emissões (contabilidade + médico/empresa), mapeamento do fluxo real do lote de contabilidade introduzido em `a273030`, 51 gaps catalogados com `arquivo:linha`, 23 recomendações priorizadas e 8 riscos. Nenhum código de produto alterado. | @ux-design-expert |
