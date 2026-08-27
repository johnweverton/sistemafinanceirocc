# Épico 12 — Sanitização da área de Emissões (médico/empresa + clientes de contabilidade)

**Autor:** @pm (Morgan) · **Data:** 2026-08-25 · **Status:** Autorizado pelo dono — pronto para @sm quebrar em stories
**Insumo de verdade:** `docs/architecture/ux-gaps-emissoes.md` (auditoria @ux-design-expert, 2026-08-25 — 51 gaps `G-01..G-51`, 23 recomendações `R-1..R-23`, 8 riscos `RS-1..RS-8`)
**Arquitetura relacionada:** `docs/architecture/feature-emissao-contabilidade.md` (Épico 11), `docs/design-system.md`

**Contexto:** o sistema tem duas verticais de cobrança sobre o **mesmo pipeline**
(`execucoes → execucao_resultados → boletos`): a cobrança médica/empresa (Épicos 6–10) e os
honorários contábeis (Épico 11). O cálculo em lote de clientes contábeis (commit `a273030`,
2026-08-20) foi a primeira operação de massa da vertical contábil e expôs que as duas experiências
divergiram: o lote de emissão tem preview, confirmação com snapshot, progresso e retomada; o lote
contábil calcula por até 300s em silêncio, marca sucesso mesmo quando 100% do passo anterior
falhou, e não tem guarda de duplicidade de boleto — o mesmo lote rodado 2x na mesma competência
gera **dois boletos** para o mesmo cliente (`RS-1`).

Este épico **não adiciona capacidade de negócio nova**: ele fecha as lacunas de fluxo, de risco
financeiro e de acessibilidade da área de emissões, e converge os dois lados para um padrão único.
O dono autorizou a implementação de **todos** os gaps, em ordem de prioridade, seguindo o pipeline
AIOX completo (@pm → @sm → @po → @dev → @qa).

**Por que agora:** três dos gaps são risco financeiro direto (`RS-1` boleto duplicado, `RS-2`
liberação de resultado com R$ 0,00, `RS-3` faturamento lançado na competência errada) e a carteira
contábil está em crescimento — o custo de cada um sobe linearmente com o número de clientes.
O gap de papéis (`RS-4`) bloqueia a delegação da operação para quem não é `admin`, ou seja, bloqueia
a adoção do próprio módulo.

---

## 0. Numeração do épico

Varredura em `docs/stories/` (2026-08-25): o maior épico com stories é o **11**
(`11.1`–`11.5`). Não existe nenhum arquivo `12.*.story.md` nem `10.9.*.story.md` no repositório,
e o trabalho de sub-lotes (pediatria e imobilizações) já **foi commitado** sem stories associadas
(`ded85e3` 2026-08-21, `7803dc0` 2026-08-25) — logo não há número reservado em disputa.
**Este épico é o 12.** Se o trabalho de sub-lotes for retro-documentado, o lugar natural dele é
o Épico 10 (motor de cálculo), como 10.9 — não o 12.

---

## 1. Decisões (opções e trade-offs)

### D1 — Convergência dos dois lotes: qual desenho vence? *(§4.4 da auditoria)*

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (decidida)** | **Convergência comportamental**: o lote contábil passa a cumprir os 6 passos do padrão de "operação em lote" já materializado no `LoteEmissaoDialog`, reaproveitando os componentes que já existem (`ProgressoExecucao`, `useExecucaoRealtime`, `LoteEmissaoDialog`) — sem criar um componente genérico novo | Entrega o comportamento sem refatorar o que já funciona; cada story é pequena e reversível; não expõe o `LoteEmissaoDialog` (consumido por 2 fluxos, `RS-5`) a um refactor estrutural | O padrão fica documentado + testado, não encapsulado num único componente — depende de disciplina nas próximas telas |
| B | Extrair agora um organismo genérico `<OperacaoEmLote>` parametrizado, e reescrever os dois lotes sobre ele | Padrão impossível de burlar depois | Refactor de alto risco em cima de `LoteEmissaoDialog`, que serve relatório de execuções **e** lote contábil (`RS-5`) — exige regressão completa nos dois domínios antes de qualquer ganho de UX; e hoje só há **2** casos, não 3 (regra de três não atingida) |
| C | Tapar só os buracos pontuais, sem norte comum | Menor esforço imediato | Cada tela nova reabre a discussão; o operador — que é **a mesma pessoa** nos dois domínios — continua aprendendo duas rotinas |

**Decisão: A.** O padrão-alvo, replicado da auditoria §4.4, é o **critério de aceite transversal do
épico**:

```
1. Seleção        → contagem + composição + exclusões explicadas
2. Pré-requisitos → passo condicional (faturamento) com retry por item
3. Preview        → o que vai acontecer, o que será pulado e por quê, total real
4. Confirmação    → uma vez, com snapshot
5. Progresso      → barra + %, aria-live, pausa/retomada, "fechar não cancela"
6. Resultado      → ok/pulado/falha com motivo acionável e caminho de correção
```

**Matriz de conformidade (fecha o épico):**

| Passo | Lote de médicos (hoje) | Lote contábil (hoje) | Story que fecha o lote contábil |
|---|---|---|---|
| 1 Seleção | ✅ `NovaExecucao` (prontos / vínculo pendente / já emitido) | ⚠️ contagem seca + contagens divergentes | **12.5** (+ **12.3** para "já emitido") |
| 2 Pré-requisitos | n/a | ❌ sem retry, sucesso falso | **12.4** |
| 3 Preview | ✅ | ❌ inexistente | **12.5** |
| 4 Confirmação | ✅ snapshot (`LoteEmissaoDialog`) | ❌ clique direto | **12.5** (confirmação informada; snapshot formal permanece na etapa de emissão) |
| 5 Progresso | ✅ `ProgressoExecucao` | ❌ rótulo "Calculando…" | **12.5** |
| 6 Resultado | ⚠️ sem ação para alerta de não-médico | ⚠️ alertas mudos, erro vira "vazio" | **12.4**, **12.6**, **12.10** |

### D2 — Sequenciamento: fundação técnica antes das ALTAs?

R-5 (`<Modal>` acessível) é ALTA e é pré-requisito declarado de G-37/38/39. R-12 (moléculas
compartilhadas) é **MÉDIA por impacto**, mas toca exatamente os arquivos que 6 stories ALTA vão
editar (`LoteContabilidadeDialog`, `GerarExecucao`, `FaturamentoEEmissao`, `NovaExecucao`).

| Opção | Prós | Contras |
|-------|------|---------|
| **A (decidida)** | R-5 e R-12 primeiro, como "Fase 0" | Cada arquivo do caminho de emissão é aberto **uma vez** já com `<Modal>`, `brl()` e `<CampoCompetencia>` disponíveis; evita re-QA dos mesmos componentes; a11y entra por construção, não por retrofit | Atrasa em ~2 stories o fechamento do risco financeiro `RS-1` |
| B | Ordem estrita de prioridade (R-1 primeiro) | Fecha o risco financeiro antes | `LoteContabilidadeDialog` seria reescrito 3x (duplicidade → modal → moléculas), com 3 rodadas de regressão do mesmo componente |

**Decisão: A**, com **válvula de escape**: 12.1 e 12.2 são paralelizáveis entre si, e 12.3 (guarda
de duplicidade) **não depende funcionalmente** de nenhuma das duas — depende só de não conflitar
no mesmo arquivo. Se a decisão do dono sobre `RS-1` chegar antes da Fase 0 terminar, @sm pode puxar
12.3 para a frente assumindo o custo de um merge manual em `LoteContabilidadeDialog.tsx`.

### D3 — Meta de acessibilidade *(pergunta em aberto §5.2.8 — decisão autônoma @pm)*

| Opção | Prós | Contras |
|-------|------|---------|
| **A (decidida)** | **WCAG 2.1 nível AA**, como a auditoria calibrou | O pacote ARIA completo é escrito **uma vez** dentro do `<Modal>` (12.1) — o custo marginal sobre "só foco + Escape" é de poucas linhas; o repo já tem 4 modais com a semântica correta (`ExtratoManager`, `DreManager`, `LinkPublicoBI`), então AA é o **padrão da casa**, não invenção | Exige critério de aceite de a11y nas stories (contraste, `aria-live`, rótulos) |
| B | Só "não quebrar teclado" (foco + Escape) | Menos ACs | Espalharia a decisão por 6 componentes e deixaria o leitor de tela sem contexto justamente nas telas que movimentam dinheiro |

**[DECISÃO-PM]** Meta = **WCAG 2.1 AA** para o caminho de emissão. Motivo: o custo incremental é
quase todo absorvido pelo componente único de 12.1, e o repositório já demonstra o padrão.

### D4 — Contraste do token `cc-muted` *(R-22 — restrição explícita do dono)*

**Adotada a opção (a) da auditoria**: trocar `cc-muted` por `cc-ink-2` (6,98:1, já conforme)
**apenas nos pontos citados em G-44**. **Não** alterar `--text-muted`, `docs/design-system.md`
ou qualquer variável CSS global — a opção (b) re-skina a UI inteira (`RS-7`) e é decisão do dono,
não do épico. Isto é uma **restrição de escopo**, não uma preferência: qualquer story que proponha
mexer no token deve ser devolvida pelo @po.

### D5 — Onde mora a emissão de contabilidade *(§5.2.7 — decisão autônoma @pm)*

| Opção | Prós | Contras |
|-------|------|---------|
| **A (decidida)** | Manter `/execucoes` **compartilhado** + neutralizar o vocabulário (R-10) + criar a entrada "Emissões" na seção *Contabilidade* da Sidebar apontando para o histórico **filtrado por tipo de pagador** (R-23) | É o caminho de menor custo apontado pela própria auditoria; um pipeline, uma tela de relatório, um lugar para corrigir bug; respeita a divisória de navegação pedida em 2026-07-24 sem duplicar tela | O relatório continua sendo uma tela "de todo mundo" — exige disciplina de vocabulário neutro |
| B | Tela dedicada de emissões contábeis | Clareza máxima por domínio | Duplica relatório, histórico, filtros e ações em massa; dobra a superfície de regressão de `RS-5`; sem ganho funcional |

**[DECISÃO-PM]** A. Consequência: **R-23 (12.19) depende de R-10 (12.11)** — a entrada de menu só
faz sentido depois que o histórico souber filtrar por tipo de pagador.

### D6 — `fixo` e `faixa_faturamento` no mesmo lote? *(§5.2.6 — decisão autônoma @pm)*

**[DECISÃO-PM] Manter lote único misto e explicar a composição** (R-4/12.5), em vez de separar em
dois lotes. Trade-off: separar produz duas rotinas mentais limpas, mas obriga o operador a rodar
**dois** lotes todo mês e duplica diálogo, rota e testes — para um problema que a auditoria mostra
ser de **comunicação** (G-12: a tela não diz quantos são `fixo`), não de mecânica (§2.7: a mistura
"funciona"). Gatilho de reavaliação: se o painel de composição de 12.5 não reduzir a confusão
relatada, separar vira story própria — barata, porque a partição por `modoCobranca` já existe em
`LoteContabilidadeDialog.tsx:43`.

### D7 — Tamanho da carteira e escopo de R-13 *(§5.2.4 — decisão autônoma @pm)*

A auditoria condiciona a prioridade de R-13 ao tamanho da carteira (dado que não está no código,
está no banco). Em vez de bloquear, **quebro R-13 em núcleo + condicional**:

- **Núcleo (12.15, obrigatório, barato):** contador "X de Y preenchidos", altura responsiva
  (`max-h-52` → `max-h-[40vh]`), ordenação "pendentes primeiro".
- **Condicional (fora do épico, gatilho quantitativo):** busca dentro do diálogo, "aplicar valor a
  todos os vazios" e rascunho em `localStorage` — só quando **> 50 clientes `faixa_faturamento`
  ativos numa competência**. Abaixo disso, o custo de manter rascunho persistido (e o risco de
  `RS-3`, valor de um mês reaparecendo em outro) supera o ganho.

**[DECISÃO-PM]** Núcleo agora, extras por gatilho medível.

### D8 — Adicional semestral em cliente `faixa_faturamento` *(§5.2.3 — decisão autônoma @pm)*

**[DECISÃO-PM] Tratar G-17 como gap de implementação, não como regra de negócio implícita.**
Evidência: (i) o cadastro permite `adicionalAtivo` em qualquer modo
(`ClienteContabilidadeForm.tsx:123-125`, `:244-249`); (ii) a arquitetura do Épico 11 descreve o
adicional como **exceção pontual de cadência e valor** (§0.3, §D4), nunca como característica do
`modoCobranca`. Logo, a UI está errada, não o cadastro. Reversibilidade: se o dono depois disser
"adicional só para `fixo`", o conserto é **uma regra de Zod no cadastro** — não um rollback da UI.

### D9 — Adicional semestral em lote *(§5.2.2 — decisão autônoma @pm)*

**[DECISÃO-PM] Manter fora do lote** (decisão de código já existente e deliberada,
`execucao-orchestrator.ts:817,845`) **e tornar a exclusão visível**: o painel de composição (12.5)
lista "V clientes com adicional vencendo em {competência} — não incluído neste lote, gere
individualmente", reaproveitando `lib/adicional-semestral.ts`, que já existe e já é usado em
`GerarExecucao.tsx:33`. Incluir o adicional no lote misturaria duas cobranças de naturezas
diferentes num mesmo snapshot de confirmação — risco desproporcional ao ganho.

### D10 — Refactor do `NovaExecucao.tsx` (1.227 linhas, 3 modos, ~18 estados)

**Fora de escopo deste épico.** É o arquivo mais quente do repositório (dois commits nos últimos 4
dias: `ded85e3`, `7803dc0`) e um refactor estrutural competiria com trabalho de negócio em
andamento (`RS-8`). As stories que o tocam (12.2, 12.9) fazem **substituições localizadas**, não
reorganização. Se o refactor for desejado, vira épico próprio depois deste.

---

## 2. Reuso vs. Criação (IDS)

| Reaproveitado (sem mudar) | Adaptado (extensão aditiva) | Criado |
|---|---|---|
| `LoteEmissaoDialog` (mecanismo de preview→confirmação→polling), `ProgressoExecucao`, `useExecucaoRealtime`, `lib/adicional-semestral.ts`, `lib/reajuste-anual.ts`, `lib/competencia.ts`, `.data-table`/`.alert-warning` do design system, gateway/idempotência de emissão, `listarMedicosComBoletoAtivo` como **modelo** de consulta | `LoteContabilidadeDialog` (5 stories), `RelatorioGrupos` (vocabulário, recálculo, peso visual, extração do `EmitirBoletoDialog`), `HistoricoExecucoes` (tipo/busca por pagador), `Toast` (`role="alert"`, pausa no hover), `ConfirmDialog`/`SyncModal`/`RecebiveisManager` (migração para `<Modal>`), `faturamentos/lote` (devolver `nome` em `falhas[]`), `recalculo-resultado.ts` (empresa/cliente contábil), `Sidebar` | `components/ui/Modal.tsx`, `components/ui/CampoCompetencia.tsx`, `lib/formato.ts` (`brl`, `normalizarBusca`), `competenciaAtual()` em `lib/competencia.ts`, `components/boletos/EmitirBoletoDialog.tsx` (extraído), `GET /api/clientes-contabilidade/com-boleto`, `listarClientesContabilidadeComBoletoAtivo` |

**Nota de reuso (grounded):** `lib/competencia.ts` **já existe** e já hospeda aritmética pura de
competência (`competenciaAnterior`) — `competenciaAtual()` deve entrar **lá**, não num arquivo
novo. `lib/formato.ts` fica só com `brl()` e `normalizarBusca()`.

---

## 3. Riscos

Herdados da auditoria (§5.1) — todos endereçados por alguma story deste épico:

| # | Risco | Severidade | Endereçado por |
|---|---|---|---|
| RS-1 | Boleto duplicado para cliente contábil (2 execuções → 2 boletos) | **Alta** | 12.3 (GATE do dono) |
| RS-2 | "Revisar e liberar" libera resultado com R$ 0,00 | Média | 12.13 |
| RS-3 | Lançamento em massa na competência errada | Média | 12.4 |
| RS-4 | Nenhum papel além de `admin` completa o fluxo | Média | 12.8 (GATE do dono) |
| RS-5 | `LoteEmissaoDialog` serve 2 fluxos — toda mudança exige regressão dupla | Média | D1-A (não refatorar o organismo) + AC de regressão em 12.1 |
| RS-6 | Perda silenciosa de trabalho (valores digitados / `execucaoId` não recuperável) | Baixa/Média | 12.5 (recuperação do `execucaoId`) + D7 (rascunho condicional) |
| RS-7 | Mudar `cc-muted` re-skina a UI inteira | Baixa | D4 (opção cirúrgica, token intocado) |
| RS-8 | Sobreposição com o trabalho de sub-lotes em `NovaExecucao.tsx` | Baixa | Reduzido: o trabalho foi commitado em `7803dc0`; ainda assim 12.2/12.9 devem rebasear antes de abrir |

Riscos **novos, próprios do épico**:

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| RS-9 | **Contenção de arquivo**: 5 stories editam `LoteContabilidadeDialog.tsx` (12.3, 12.4, 12.5, 12.6, 12.8) | Média | Sequenciamento estrito dessas 5; nenhuma abre antes da anterior fechar o gate de @qa |
| RS-10 | **2 stories dependem de decisão do dono** (12.3/`RS-1`, 12.8/`R-6`) e podem travar a fase ALTA | Média | Regra de desbloqueio no §5; ambas foram posicionadas de forma que as demais ALTAs não dependam delas |
| RS-11 | 12.1 migra **6 modais de uma vez**, incluindo 2 fora do caminho de emissão (`RecebiveisManager`, `SyncModal`) | Média | Testes de componente por modal migrado + smoke manual nas 6 telas; se a story ficar grande, @sm pode partir em 12.1a (componente + 4 modais de emissão) e 12.1b (recebíveis + sync) |
| RS-12 | **Escopo total grande** (19 stories) — risco de o épico nunca "fechar" e virar backlog eterno | Média | Fases com valor entregável isolado: **Fase 0+1 é o MVP de segurança** (risco financeiro + bloqueios de fluxo) e pode ser declarada como marco; Fases 2 e 3 são polimento incremental |
| RS-13 | Gaps **sem recomendação** na auditoria (G-20, G-23, G-29, G-30) poderiam ser perdidos, mas o dono autorizou "todos os gaps" | Baixa | Realocados explicitamente: G-20→12.12, G-23→12.6, G-29/G-30→12.9 |
| RS-14 | **`RS-1` fica reduzido, não eliminado.** A guarda da 12.3 é client-side (busca antes de calcular): (a) corrida entre duas abas na mesma janela; (b) `staleTime` global de 30s no client mantém a checagem desatualizada dentro do próprio diálogo aberto (`DEB-12.3-B`, mitigado na 12.4); (c) calcular → calcular de novo → emitir os dois passa inteiro, porque nada no servidor barra por (cliente, competência) — só por `execucao_resultado_id`. Achado do `@qa` no gate da 12.3, não do `@dev`. | Média | **Sem dono.** Fechar exigiria guarda transacional no servidor (idempotência por `(cliente_contabilidade_id, competência)`, não só por `execucao_resultado_id`) — fora do escopo das 19 stories aprovadas. Registrado para decisão do dono: vira story nova (Épico 12 ou 13) ou risco aceito conscientemente. Nenhuma story/PR deste épico pode declarar `RS-1` "eliminado" — só "reduzido". |
| RS-15 | **O fluxo médico ficou menos seguro que o contábil.** A 12.3 revelou que `NovaExecucao.tsx:177-185` (guarda `medicosComBoleto`, o modelo que a 12.3 espelhou) desestrutura só `data` do `useQuery`, sem `isError`/`isSuccess` — falha **aberta** silenciosamente (deixa disparar mesmo se a checagem falhar), ao contrário da 12.3, que decidiu falhar fechada de propósito. Não é uma decisão documentada do lado médico, é ausência de tratamento nunca notada. | Média | **Sem dono.** Fora do escopo das 19 stories (nenhuma delas toca esse trecho). Recomendação do `@qa`: não replicar esse comportamento em nenhuma story futura só por "consistência com o padrão existente" — o padrão tem um bug. Decisão de portar a correção para o lado médico fica para o dono priorizar. |

---

## 4. Stories

Legenda: **[GATE]** = bloqueada por decisão do dono · **[DEP]** = depende de outra story do épico.
Todas as stories: nenhuma alteração em `docs/design-system.md` nem em variáveis CSS (D4).

### Fase 0 — Fundação técnica (habilitadores)

#### 12.1 — Componente `<Modal>` único e acessível
- **Objetivo:** eliminar as cascas de modal duplicadas e dar semântica de diálogo ao caminho de emissão.
- **Cobre:** R-5 · G-37, G-38, G-39.
- **Arquivos:** `components/ui/Modal.tsx` (novo); migração de `components/ui/ConfirmDialog.tsx`, `components/clientes-contabilidade/LoteContabilidadeDialog.tsx`, `components/execucoes/LoteEmissaoDialog.tsx`, `components/execucoes/RelatorioGrupos.tsx` (`EmitirBoletoDialog`), `components/recebiveis/RecebiveisManager.tsx`, `components/medicos/SyncModal.tsx`. `AcaoRevisar` (mesmo arquivo) **não entra aqui** — é disclosure inline sem overlay, não modal; sua semântica de acessibilidade é responsabilidade da 12.13. Referências de implementação correta já no repo: `components/extrato/ExtratoManager.tsx:116`, `components/dre/DreManager.tsx:102`, `components/relatorios/LinkPublicoBI.tsx:53`.
- **Critério de pronto:** os **6** modais do caminho de emissão têm `role="dialog"`, `aria-modal`, `aria-labelledby`; o foco entra no primeiro elemento interativo ao abrir e **volta ao gatilho** ao fechar; Tab não escapa para a página de trás; Escape e clique no backdrop fecham — e ficam **bloqueados quando há operação em voo** (lote confirmado em processamento); o modal-dentro-de-modal do lote contábil exibe breadcrumb no título ("Lote 2026-08 · Emitir boletos") e "← Voltar ao lote" ao lado de "Fechar". Métrica: 6/6 com semântica de diálogo (era 0/6).
- **Regressão obrigatória (`RS-5`):** `LoteEmissaoDialog` aberto pelos **dois** caminhos (relatório de execuções e lote contábil).
- **[DEP]** nenhuma. Paralelizável com 12.2.

#### 12.2 — Moléculas compartilhadas e formato pt-BR
- **Objetivo:** um único padrão de competência e de dinheiro em todo o caminho de emissão.
- **Cobre:** R-12 · G-27, G-28 (+ as 4 cópias de `brl()`, 3 de `competenciaAtual()`, 4 de `normalizarBusca()`).
- **Arquivos:** `lib/formato.ts` (novo: `brl`, `normalizarBusca`), `lib/competencia.ts` (**existente** — recebe `competenciaAtual()`), `components/ui/CampoCompetencia.tsx` (novo, `type="month"`); consumidores: `components/execucoes/{NovaExecucao,LoteEmissaoDialog,RelatorioGrupos,HistoricoExecucoes}.tsx`, `components/clientes-contabilidade/{LoteContabilidadeDialog,GerarExecucao,FaturamentoEEmissao,DetalheCliente}.tsx`.
- **Critério de pronto:** nenhuma cópia local de `brl`/`competenciaAtual`/`normalizarBusca` no `apps/web/src` — a auditoria original estimou 11 duplicações olhando só o caminho de emissão; a varredura completa do `@dev` achou 27 reais (18 `brl` + 6 `normalizarBusca` + 3 `competenciaAtual`), e a cláusula é universal ("nenhuma cópia... no `apps/web/src`"), não limitada ao caminho de emissão — eliminadas as 27 → 4 utilitários (`@qa` confirmou, gate `12.2`, PASS); nenhuma tela renderiza `R$ 1480.56`; os 6 pontos de competência usam o mesmo componente e é **impossível digitar `2026-13`** (hoje o `<input>` texto de `NovaExecucao.tsx:441,:821,:977` aceita e o botão só fica desabilitado, sem dizer por quê).
- **[DEP]** nenhuma. **Rebase obrigatório** sobre `7803dc0` antes de abrir (`RS-8`).

### Fase 1 — ALTA (risco financeiro e bloqueios de fluxo)

#### 12.3 — Guarda de duplicidade de boleto para clientes contábeis **[GATE]**
- **Objetivo:** impedir que o mesmo cliente contábil receba dois boletos na mesma competência.
- **Cobre:** R-1 · G-09 · `RS-1`.
- **Arquivos:** `app/api/clientes-contabilidade/com-boleto/route.ts` (novo, espelha `app/api/execucoes/medicos-com-boleto/route.ts`), `server/repositories/boleto-repository.ts` (`listarClientesContabilidadeComBoletoAtivo`, mesmo shape de `listarMedicosComBoletoAtivo:230-248`, trocando `medico_id` por `cliente_contabilidade_id`), `services/clientes-contabilidade.ts`, `components/clientes-contabilidade/LoteContabilidadeDialog.tsx`.
- **GATE — decisão pendente do dono (§5.2.1 da auditoria): "existe reemissão intencional na mesma competência?"** Os dois cenários, sem escolha do @pm:
  - **Cenário A — não existe reemissão legítima:** bloqueio duro. Os clientes já cobertos aparecem num bloco "**Já emitido nesta competência (N)**" e são **removidos do payload**, exatamente como `NovaExecucao.tsx:1123-1140` faz para médicos.
  - **Cenário B — existe caso legítimo (complemento, correção após cancelamento):** o bloco "Já emitido (N)" aparece com **opt-in explícito por cliente** e registro do motivo, de forma que a distinção entre erro e intenção fique no ato deliberado de marcar.
  - *Insumo para a decisão, do código:* `listarMedicosComBoletoAtivo` filtra `status in ('emitido','pago')` — boleto **cancelado não conta**. Ou seja, o caso "correção após cancelamento" já é naturalmente liberado mesmo no Cenário A; o que resta decidir é o caso "complemento sem cancelar o anterior".
- **Critério de pronto:** rodar o mesmo lote/competência duas vezes **não** produz dois boletos ativos para o mesmo cliente; a tela mostra quem foi excluído e por quê **antes** do cálculo; sem cache na rota (mesmo motivo documentado na rota de médicos: precisa refletir emissão feita há segundos).
- **[DEP]** contenção de arquivo com 12.4/12.5/12.6/12.8 (`RS-9`).

#### 12.4 — Fechar o loop do lançamento de faturamento em massa
- **Objetivo:** acabar com o "sucesso falso" do passo 1 e tornar as falhas identificáveis e recuperáveis.
- **Cobre:** R-2 · G-01, G-02, G-03, G-04 · `RS-3`.
- **Arquivos:** `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:46-62,:112-115,:121`, `services/clientes-contabilidade.ts:66-69`, `app/api/clientes-contabilidade/faturamentos/lote/route.ts`, `server/repositories/cliente-contabilidade-faturamento-repository.ts:64-80`.
- **Critério de pronto:** (a) o passo 1 só avança quando `lancados > 0`; com 12 de 12 falhas a tela **continua** no passo 1; (b) as falhas são renderizadas **por nome do cliente** num bloco persistente (padrão já correto em `ClientesContabilidadeManager.tsx:278-286`), o que exige o backend devolver `nome` em `falhas[]` — não só o UUID; (c) botão "Tentar de novo (N que falharam)" remonta o passo 1 **só com os pendentes**; (d) trocar a competência com valores digitados **limpa os valores ou pede confirmação explícita** ("manter os 12 valores digitados para 2026-08?").
- **[DEP]** 12.1 (usa `<Modal>`), 12.2 (`<CampoCompetencia>`), 12.3 (mesmo arquivo).

#### 12.5 — Composição do lote e progresso real do cálculo
- **Objetivo:** o operador saber **o que vai ser cobrado, de quem e quanto** antes de calcular, e ver o cálculo acontecer.
- **Cobre:** R-3, R-4 · G-06, G-08, G-11, G-12, G-13, G-15 · passos 1, 3, 4 e 5 da matriz D1 · `RS-6` (parcial).
- **Arquivos:** `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:82,:155-183,:207-212`, `components/clientes-contabilidade/ClientesContabilidadeManager.tsx:315-340` (G-15), `components/execucoes/ProgressoExecucao.tsx` (reuso), `hooks/useExecucaoRealtime.ts` (reuso), `lib/adicional-semestral.ts` (reuso).
- **Critério de pronto:** (a) antes do cálculo, no lugar de "Pronto pra calcular N clientes", um resumo estruturado: `X em faixa de faturamento (Y lançado · Z pendente) · W em valor fixo · V com adicional semestral vencendo em {competência} — não incluído neste lote, gere individualmente · L inativos removidos da seleção`, mais o teto de 200 e o limite de 3 chamadas/min **antes** do clique (hoje só aparecem como erro depois); (b) a barra de seleção não mostra mais dois números sem explicação ("10 selecionados" ao lado de "Calcular em lote (7)"); (c) durante o cálculo há barra + % + `role="status"`, e aviso de travamento com ação de recuperação; (d) depois do cálculo, o card "Total" vira "**A emitir** (só os `ok`)" com "Total geral" como linha secundária; (e) o `execucaoId` é recuperável se a rede cair no meio (sub-produto de (c)).
- **[DEP]** 12.1, 12.2, 12.4.

#### 12.6 — Separar "erro" de "vazio" em todos os pontos de carga
- **Objetivo:** o operador nunca mais concluir que "o cadastro sumiu" ou "o lote não calculou nada" por causa de uma falha de rede.
- **Cobre:** R-8 · G-07, G-16, **G-23** (gap órfão: `Acompanhamento` sem estado de carregamento).
- **Arquivos:** `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:73-79`, `components/clientes-contabilidade/EmissaoCliente.tsx:22-23`, `components/clientes-contabilidade/DetalheCliente.tsx:64-65`, `components/clientes-contabilidade/GerarExecucao.tsx:141-144`.
- **Critério de pronto:** com a rede derrubada, cada um dos 4 pontos mostra mensagem **específica de falha** + botão "Tentar novamente" — e nunca "Cliente contábil não encontrado." nem "Ok 0 / Alerta 0 / R$ 0,00"; o card de acompanhamento tem skeleton enquanto o realtime não responde (hoje fica visualmente vazio).
- **[DEP]** 12.5 (mesmo arquivo). Story pequena (esforço B) e independentemente publicável.

#### 12.7 — Confirmação de emissão consistente entre domínios
- **Objetivo:** cliente contábil também passar pela "última barreira contra emissão pela conta errada".
- **Cobre:** R-7 · G-22.
- **Arquivos:** `components/boletos/EmitirBoletoDialog.tsx` (**extraído** de `components/execucoes/RelatorioGrupos.tsx:333-382`), consumidores `RelatorioGrupos.tsx:303-315` e `components/clientes-contabilidade/GerarExecucao.tsx:160-164`.
- **Critério de pronto:** emitir boleto de cliente contábil deixa de ser 1 clique e passa pelo **mesmo** diálogo do fluxo médico, com a **conta emissora visível** (clientes contábeis já têm `contaEmissora` no cadastro); zero duplicação de código de confirmação entre os dois domínios.
- **[DEP]** 12.1 (o diálogo extraído nasce sobre `<Modal>`).

#### 12.8 — Papéis visíveis antes do clique **[GATE]**
- **Objetivo:** nenhum operador descobrir por 403, no último passo, que não pode concluir a operação.
- **Cobre:** R-6 · G-05 · `RS-4`.
- **Arquivos:** `app/api/clientes-contabilidade/faturamentos/lote/route.ts:12`, `app/api/clientes-contabilidade/lote/route.ts:19`, `app/api/boletos/lotes/route.ts:23`, `app/api/boletos/lotes/[id]/confirmar/route.ts:31`, `components/clientes-contabilidade/LoteContabilidadeDialog.tsx`, `components/execucoes/RelatorioGrupos.tsx:273`.
- **Estado atual (evidência):** as 4 etapas exigem conjuntos **não sobrepostos** — lançar faturamento (`admin, colaborador, financeiro`), calcular (`admin, colaborador`), preview (`admin, financeiro`), confirmar (**`admin`**). Nenhum papel além de `admin` completa o fluxo.
- **GATE — decisão pendente do dono (§5.2.5: "quem opera o lote no dia a dia?").** Os dois cenários, sem escolha do @pm:
  - **Cenário A — quem opera é sempre o dono (`admin`):** o gap é teórico. Entrega-se **apenas a frente (ii)**: a UI conhece o papel da sessão e avisa **no início** o que o usuário conseguirá concluir. **Nenhuma rota muda.**
  - **Cenário B — a intenção é delegar a `colaborador`/`financeiro`:** é bloqueador. Além da frente (ii), exige **decisão de produto** sobre qual papel ganha capacidade ponta a ponta, alinhando as 4 rotas para que exista **pelo menos um perfil não-admin** capaz de operar o fluxo inteiro — com o cuidado de que `confirmar` é hoje a única barreira que separa "montar preview" de "emitir dinheiro".
- **Critério de pronto (comum aos dois cenários):** ao abrir o diálogo, um `colaborador` lê "você pode lançar o faturamento e calcular; a emissão precisa de um admin" — em vez de tomar 403 no último passo; os botões que o papel não pode executar não ficam habilitados.
- **[DEP]** 12.1, contenção com 12.3–12.6.

#### 12.9 — Clareza das regras que mudam o valor na nova emissão
- **Objetivo:** tirar do rodapé a regra de maior impacto financeiro da tela e explicar por que o botão está bloqueado.
- **Cobre:** **G-29, G-30** (gaps órfãos — sem R na auditoria, incluídos por autorização do dono a "todos os gaps").
- **Arquivos:** `components/execucoes/NovaExecucao.tsx:373-378,:386-405,:454-462,:725-744,:794-802,:991-997`.
- **Critério de pronto:** (a) a regra "escolher um sub-lote de consultas transforma os demais sub-lotes em guia principal" sai de `text-xs text-cc-muted` e vira aviso com peso proporcional ao impacto (afeta o valor cobrado), com os dois namespaces do `<select>` — sub-lotes de `fin-lotes` vs. produções flat — distinguíveis sem depender só do rótulo do `optgroup`; (b) botão desabilitado **diz o que falta** ("informe a competência", "selecione ao menos 1 médico") em vez de só exibir "Processar 0 médicos"; (c) o modo empresa comunica que a regra é **tudo ou nada** (`canDispararEmpresa`), em vez de mostrar "(2/7 médicos)" sem explicação.
- **[DEP]** 12.2 (mesmo arquivo). **Rebase obrigatório** sobre o trabalho de sub-lotes (`RS-8`).

> **Marco "MVP de segurança" — fim da Fase 1.** Neste ponto o risco financeiro direto está
> endereçado, o lote contábil cumpre os 6 passos do padrão D1 e nenhum operador descobre limites
> por erro. As Fases 2 e 3 são polimento incremental e podem ser priorizadas contra outro trabalho.

### Fase 2 — MÉDIA

#### 12.10 — Alertas acionáveis e recálculo universal
- **Objetivo:** fechar o ciclo alerta → correção → recálculo sem refazer o lote inteiro.
- **Cobre:** R-9 · G-10, G-21, G-31 · passo 6 da matriz D1.
- **Arquivos:** `components/execucoes/RelatorioGrupos.tsx:184-194,:501-503`, `components/clientes-contabilidade/GerarExecucao.tsx:145-165`, `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:184-194`, `server/orchestrator/recalculo-resultado.ts`, `app/api/execucoes/**` (rota de recálculo existente).
- **Critério de pronto:** um resultado em alerta de cliente contábil oferece "Abrir cliente", "Lançar faturamento de {competência}" e "**Recalcular**"; `onRecalcular` deixa de depender de `r.medicoId` e passa a valer para `clienteContabilidadeId` e `empresaId`; a lista de alertas do lote mostra **todos** os alertas do cliente, não só `alertas[0]`.
- **[DEP]** 12.5 (o resultado do lote já precisa distinguir "a emitir" de "total").

#### 12.11 — Vocabulário neutro, histórico multi-pagador e peso visual coerente
- **Objetivo:** a tela de relatório/histórico parar de ser "de médico" agora que serve três tipos de pagador.
- **Cobre:** R-10, R-16 · G-33, G-34, G-35.
- **Arquivos:** `components/execucoes/RelatorioGrupos.tsx:229,:246,:273,:439,:545`, `components/execucoes/ProgressoExecucao.tsx:62`, `components/execucoes/HistoricoExecucoes.tsx:45,:72-74,:273-275`.
- **Critério de pronto:** "Pagador" no lugar de "médico" nas duas telas; badge de tipo (Médico · Empresa · Cliente contábil) na linha do resultado; `HistoricoExecucoes` ganha coluna/filtro "Tipo" e busca por **nome de pagador** — uma execução de cliente contábil deixa de aparecer **sem identidade** e passa a ser localizável pelo nome; `tipoDaExecucao` classifica por **origem real** da execução, não por `totalMedicos === 1` (hoje um lote contábil com 0 médicos é rotulado "Em massa" e uma execução singular contábil também); "Emitir todos os pendentes" vira `btn-primary` e a emissão individual `btn-secondary` — a ação de maior alcance passa a ser a mais evidente.
- **[DEP]** nenhuma dentro da fase. **Habilita 12.19.**

#### 12.12 — Anúncios assistivos e dados críticos fora do toast
- **Objetivo:** nenhum dado necessário para decidir viver só num toast de 4,2 s.
- **Cobre:** R-14, R-17 · G-18, **G-20** (gap órfão), G-40, G-41, G-42, G-43.
- **Arquivos:** `components/ui/Toast.tsx:41,:51-54,:71,:72,:89`, `components/clientes-contabilidade/FaturamentoEEmissao.tsx:49-50,:62-66,:110,:156-161`, `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:130-140,:167`, `components/execucoes/LoteEmissaoDialog.tsx:114,:216`, `components/clientes-contabilidade/{EmissaoCliente,DetalheCliente,GerarExecucao}.tsx`.
- **Critério de pronto:** `kind='error'` usa `role="alert"` (assertivo) e não `role="status"`; o timer do toast **pausa no hover/foco** (WCAG 2.2.1); o **valor calculado** e os alertas da regra de preço ficam **persistidos na tela**, não só no toast; `podeAvancarParaEmissao` exibe o **valor lançado e o valor calculado**, não apenas "Faturamento de 2026-08 lançado" (G-20); os 6 pontos de carregamento usam `role="status" aria-live="polite"` (padrão já correto em `ProgressoExecucao.tsx:58,:103`); cada input de faturamento tem `<label htmlFor>`/`aria-label` com o **nome do cliente** — o leitor de tela deixa de anunciar "campo numérico, 0.00" 40 vezes; a barra de acento do toast para de escapar do card (falta `relative` em `Toast.tsx:72`).
- **[DEP]** 12.4 (o bloco de falhas por nome já deve existir para virar "mensagem composta fora do toast").

#### 12.13 — Confirmação em operações irreversíveis silenciosas
- **Objetivo:** nenhuma sobrescrita ou liberação de valor acontecer sem o operador ver o número.
- **Cobre:** R-15 · G-19, G-32 · `RS-2`.
- **Arquivos:** `components/clientes-contabilidade/FaturamentoEEmissao.tsx:148`, `server/repositories/cliente-contabilidade-faturamento-repository.ts:30-39`, `components/execucoes/RelatorioGrupos.tsx:566-620` (`AcaoRevisar`), `server/repositories/execucao-repository.ts:409-427`.
- **Critério de pronto:** relançar faturamento numa competência que já tem valor pede confirmação mostrando "já existe R$ X lançado para esta competência" (hoje é `onConflict` silencioso); "Revisar e liberar" **exibe o valor** que está sendo liberado e destaca quando `totalValor === 0` ("este resultado será liberado com R$ 0,00 — o gateway recusa valores abaixo de R$ 5,00"), acabando com o estado em que a UI afirma "Pronto para emissão" e o gateway recusa depois.
- **[DEP]** 12.7 (ambas mexem em `RelatorioGrupos`; 12.7 primeiro, porque extrai código de lá).

#### 12.14 — Adicional semestral acessível nos dois modos de cobrança
- **Objetivo:** cliente `faixa_faturamento` com adicional ativo deixar de não ter caminho na UI.
- **Cobre:** R-11 · G-17 (gap **funcional**, não só de UX) · decisão **D8**.
- **Arquivos:** `components/clientes-contabilidade/EmissaoCliente.tsx:25-27`, `components/clientes-contabilidade/GerarExecucao.tsx:87-107` (bloco do adicional, movido), `components/clientes-contabilidade/FaturamentoEEmissao.tsx:76` (`ehAdicional` hoje fixo em `false`), `lib/adicional-semestral.ts` (reuso).
- **Critério de pronto:** o bloco do adicional sobe para `EmissaoCliente` (**acima do fork** por `modoCobranca`), de modo que qualquer cliente com `adicionalAtivo` — em qualquer modo — consiga gerar o boleto avulso; o aviso de ciclo vencendo aparece nos dois modos.
- **Nota para @po:** decisão tomada pelo @pm como **gap de implementação** (D8), com base no cadastro e na arquitetura do Épico 11 (§0.3, §D4). Se o dono definir depois que "adicional é só para `fixo`", a correção é uma regra de Zod no cadastro — não um rollback desta story.
- **[DEP]** 12.7 (a emissão do adicional passa a usar o `EmitirBoletoDialog` extraído).

#### 12.15 — Ergonomia do passo de faturamento em massa (núcleo)
- **Objetivo:** tornar operável o preenchimento de dezenas de valores num scroll de ~4 linhas.
- **Cobre:** R-13 (núcleo) · G-14 · decisão **D7**.
- **Arquivos:** `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:128-143`.
- **Critério de pronto:** contador "X de Y preenchidos" visível; lista ordenável com "pendentes primeiro"; altura da lista responsiva (`max-h-52` → `max-h-[40vh]`).
- **Fora do escopo desta story (gatilho de D7 — > 50 clientes `faixa_faturamento` ativos numa competência):** busca dentro do diálogo, "aplicar valor a todos os vazios", rascunho em `localStorage` por competência.
- **[DEP]** 12.4, 12.5 (mesmo arquivo e mesmo passo).

### Fase 3 — BAIXA (consistência e polimento)

#### 12.16 — Design system nas telas de contabilidade e contraste cirúrgico
- **Objetivo:** as telas contábeis pararem de reimplementar o que o design system já define.
- **Cobre:** R-18, **R-22 opção (a)** · G-24, G-26, G-44 · decisão **D4**.
- **Arquivos:** `components/clientes-contabilidade/DetalheCliente.tsx:116-121,:127,:156`, `components/clientes-contabilidade/FaturamentoEEmissao.tsx:110,:180`, `components/clientes-contabilidade/{GerarExecucao}.tsx:102`, `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:167,:172`, `components/execucoes/NovaExecucao.tsx:742,:1028`; **oportunístico:** migrar para `<Modal>` os 4 modais restantes fora do caminho de emissão (`DreManager.tsx:102`, `LinkPublicoBI.tsx:53`, `ExtratoManager.tsx:116,:227`), fechando a métrica **10 cascas → 1 componente**.
- **Critério de pronto:** as 3 tabelas usam `.data-table`; o aviso de reajuste anual usa `.alert-warning` (não `alert-error` vermelho com `role="alert"`, que é tom de erro para um aviso); os pontos de G-44 usam `cc-ink-2` (6,98:1) no lugar de `cc-muted` (3,70:1). **Restrição dura:** `docs/design-system.md` e as variáveis CSS **não são tocados** (`RS-7`).
- **[DEP]** 12.1 (para a parte oportunística dos 4 modais).

#### 12.17 — Responsividade e navegação por teclado nas tabelas
- **Objetivo:** a área de emissões funcionar em 320px e por teclado.
- **Cobre:** R-19, R-20 · G-45, G-46, G-47, G-48, G-49, G-50, G-51.
- **Arquivos:** `components/clientes-contabilidade/LoteContabilidadeDialog.tsx:106,:128,:130-140,:170,:185`, `components/execucoes/LoteEmissaoDialog.tsx:244`, `components/clientes-contabilidade/ClientesContabilidadeManager.tsx:315-338,:378-383`, `components/execucoes/NovaExecucao.tsx:386-405`, `components/execucoes/HistoricoExecucoes.tsx:270`, `components/execucoes/HistoricoExecucoesPorMedico.tsx:189`.
- **Critério de pronto:** contadores em `grid-cols-1 sm:grid-cols-3`; `flex-wrap` na barra de seleção e no seletor de modo; linha de faturamento em 2 linhas abaixo de `sm` (o nome do cliente deixa de truncar em ~45% da largura); o scroll de 3 níveis do diálogo é achatado para no máximo 2; linhas de tabela clicáveis viram `<Link>` no nome (**preferível**: menos ARIA, mais HTML) ou recebem `tabIndex`/`onKeyDown`/`role="button"`; a tabela de 7 colunas tem affordance de rolagem horizontal no mobile.
- **[DEP]** 12.15 (mesma lista de faturamento).

#### 12.18 — Avisos de carteira em nível de lista
- **Objetivo:** entregar a mitigação que a arquitetura do Épico 11 previa (§D5) e nunca foi construída.
- **Cobre:** R-21 · G-25.
- **Arquivos:** `components/clientes-contabilidade/ClientesContabilidadeManager.tsx`, `lib/reajuste-anual.ts` (reuso), `lib/adicional-semestral.ts` (reuso), `app/api/clientes-contabilidade/route.ts` (campos derivados na listagem).
- **Critério de pronto:** badges "Reajuste pendente" e "Adicional vencendo" na tabela de `/clientes-contabilidade`, com filtro rápido — hoje `reajusteAnualPendente` só é avaliado **um cliente por vez** dentro do detalhe, e ninguém vê a carteira inteira em janeiro/fevereiro.
- **[DEP]** nenhuma.

#### 12.19 — Navegação da vertical contábil
- **Objetivo:** a seção *Contabilidade* ter sua porta de entrada para emissões.
- **Cobre:** R-23 · G-36 · decisão **D5**.
- **Arquivos:** `components/layout/Sidebar.tsx:28,:33-39`, `components/execucoes/HistoricoExecucoes.tsx` (link com filtro pré-aplicado).
- **Critério de pronto:** entrada "Emissões" na seção *Contabilidade* apontando para o histórico **filtrado por tipo de pagador = cliente contábil**; a divisória de navegação pedida pelo dono em 2026-07-24 passa a valer também para a saída da emissão contábil.
- **[DEP]** **12.11** (o filtro por tipo de pagador nasce lá).

---

## 5. Regra de desbloqueio das stories com GATE

Duas stories dependem de decisão do dono, já solicitada em paralelo a este documento:

| Story | Pergunta em aberto | Se a resposta chegar antes da Fase 1 | Se **não** chegar |
|---|---|---|---|
| **12.3** (R-1) | §5.2.1 — reemissão intencional existe? | @sm escreve os ACs do cenário escolhido e a story entra na ordem normal | **Não bloquear o épico.** @sm avança 12.4 → 12.5 → 12.6 e 12.3 entra assim que a resposta chegar (contenção de arquivo resolvida por rebase). O risco `RS-1` permanece **aberto e visível** no status do épico até lá |
| **12.8** (R-6) | §5.2.5 — quem opera o lote no dia a dia? | idem | **Entregar só a frente (ii)** — o aviso antecipado de papel na UI, comum aos dois cenários e que não muda nenhuma rota. A frente (i) (alinhar papéis das 4 rotas) fica como story de continuação |

**@po não deve aprovar 12.3 nem 12.8 com o gate em aberto sem que a story registre explicitamente
qual cenário está sendo implementado e por decisão de quem.**

---

## 5.3 Nota de acompanhamento (achado incidental, fora das 19 stories)

**RecebiveisManager.tsx:191** tem um 7º campo de competência (filtro de lista, `<input>` texto
livre, mesmo contrato de valor do `<CampoCompetencia>`) que **nenhuma das 19 stories toca** —
achado pelo `@dev` durante a 12.2, e o `@qa` confirmou por rastreamento de dados que é filtro puro
(nunca persiste, só compõe `queryKey`/`GET /api/recebiveis?competencia=`) e que a competência
parcial digitada devolve HTTP 400 hoje (pré-existente, não regressão). Migrar pra
`<CampoCompetencia>` é de baixíssimo risco (componente já testado na 12.2) mas está **fora do
Épico 12** — a área de recebíveis não faz parte do escopo de "emissões" auditado. Registrado aqui
para não se perder; não bloqueia nenhuma story e não precisa de decisão do dono agora. Tratar como
item de backlog avulso, fora deste épico, quando alguém mexer em `RecebiveisManager.tsx` de novo.

---

## 6. Fora de escopo deste épico

- **Alterar tokens do design system** (`cc-muted`/`--text-muted`), `docs/design-system.md` ou
  variáveis CSS globais — R-22 opção (b), decisão do dono (D4, `RS-7`).
- **Refactor estrutural do `NovaExecucao.tsx`** (1.227 linhas, 3 modos, ~18 estados) — D10.
- **Componente genérico `<OperacaoEmLote>`** — D1 opção B; reavaliar quando existir um 3º caso de lote.
- **Separar o lote contábil em dois (fixo / faixa)** — D6; reavaliar após o painel de composição.
- **Incluir o adicional semestral no lote** — D9; permanece geração individual.
- **Extras de R-13** (busca no diálogo, aplicar-a-todos, rascunho em `localStorage`) — D7, gatilho > 50 clientes.
- Cancelamento em lote, estorno de boleto pago, e qualquer mudança no motor de cálculo
  (Épico 10) ou no gateway (Épicos 3/6/7).
- Retro-documentação do trabalho de sub-lotes (`ded85e3`, `7803dc0`) — pertence ao Épico 10.

---

## 7. Split de stories proposto (para @sm)

Ordem de execução. Fases 0 e 1 formam o **MVP de segurança**; 2 e 3 são incrementais.

| # | Story | Fase / Prioridade | Cobre | Depende de |
|---|-------|---|---|---|
| **12.1** | Componente `<Modal>` único e acessível | 0 · ALTA (pré-requisito) | R-5 · G-37, G-38, G-39 | — |
| **12.2** | Moléculas compartilhadas e formato pt-BR | 0 · infra (MÉDIA por impacto, ALTA por sequência — D2) | R-12 · G-27, G-28 | — (paralela a 12.1) |
| **12.3** | Guarda de duplicidade de boleto contábil **[GATE]** | 1 · ALTA | R-1 · G-09 · RS-1 | decisão do dono |
| **12.4** | Fechar o loop do lançamento em massa | 1 · ALTA | R-2 · G-01..G-04 · RS-3 | 12.1, 12.2, 12.3 |
| **12.5** | Composição do lote e progresso real | 1 · ALTA | R-3, R-4 · G-06, G-08, G-11, G-12, G-13, G-15 | 12.1, 12.2, 12.4 |
| **12.6** | Separar "erro" de "vazio" nos pontos de carga | 1 · ALTA | R-8 · G-07, G-16, G-23 | 12.5 |
| **12.7** | Confirmação de emissão com conta emissora | 1 · ALTA | R-7 · G-22 | 12.1 |
| **12.8** | Papéis visíveis antes do clique **[GATE]** | 1 · ALTA | R-6 · G-05 · RS-4 | 12.1 + decisão do dono |
| **12.9** | Clareza das regras que mudam o valor (nova emissão) | 1 · ALTA | G-29, G-30 (órfãos) | 12.2 |
| **12.10** | Alertas acionáveis e recálculo universal | 2 · MÉDIA | R-9 · G-10, G-21, G-31 | 12.5 |
| **12.11** | Vocabulário neutro, histórico e peso visual | 2 · MÉDIA | R-10, R-16 · G-33, G-34, G-35 | — |
| **12.12** | Anúncios assistivos e dados fora do toast | 2 · MÉDIA | R-14, R-17 · G-18, G-20, G-40..G-43 | 12.4 |
| **12.13** | Confirmação em operações irreversíveis | 2 · MÉDIA | R-15 · G-19, G-32 · RS-2 | 12.7 |
| **12.14** | Adicional semestral nos dois modos | 2 · MÉDIA | R-11 · G-17 | 12.7 |
| **12.15** | Ergonomia do passo de faturamento (núcleo) | 2 · MÉDIA | R-13 (núcleo) · G-14 | 12.4, 12.5 |
| **12.16** | Design system + contraste cirúrgico | 3 · BAIXA | R-18, R-22a · G-24, G-26, G-44 | 12.1 |
| **12.17** | Responsividade e teclado nas tabelas | 3 · BAIXA | R-19, R-20 · G-45..G-51 | 12.15 |
| **12.18** | Avisos de carteira em nível de lista | 3 · BAIXA | R-21 · G-25 | — |
| **12.19** | Navegação da vertical contábil | 3 · BAIXA | R-23 · G-36 | 12.11 |

**Paralelismo possível:** 12.1 ∥ 12.2 · 12.7 ∥ 12.3–12.6 (arquivos distintos) · 12.11 ∥ 12.18 ∥
qualquer coisa da Fase 2. **Serialização obrigatória (`RS-9`):** 12.3 → 12.4 → 12.5 → 12.6 e 12.8,
todas em `LoteContabilidadeDialog.tsx`.

**Cobertura:** R-1..R-23 = 23/23 · G-01..G-51 = 51/51 (incluindo os 4 gaps sem recomendação —
G-20, G-23, G-29, G-30 — realocados em 12.12, 12.6 e 12.9) · §4.4 = decisão D1 + matriz de
conformidade, fechada pelas stories 12.3–12.6 e 12.10.

**DoD deste documento:** decisões D1–D10 registradas; R-22 restrito à opção (a) por instrução do
dono; 12.3 e 12.8 marcadas **[GATE]** com os dois cenários descritos e **sem escolha do @pm**.
Próximo passo: **@sm** quebra em stories com ACs testáveis a partir deste desenho, começando por
12.1 e 12.2; **@po** valida cada uma antes de **@dev** iniciar; **@qa** fecha gate por story, com
regressão obrigatória nos **dois** consumidores do `LoteEmissaoDialog` sempre que ele for tocado.

---

## 8. Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-08-25 | 0.1 | Épico criado a partir de `ux-gaps-emissoes.md` (51 gaps, 23 recomendações, 8 riscos), autorizado integralmente pelo dono. 19 stories em 4 fases, 10 decisões (D1–D10), 5 riscos novos (RS-9..RS-13). Decisões autônomas do @pm nas perguntas não-bloqueantes do §5.2: WCAG AA (Q8/D3), navegação compartilhada + vocabulário neutro (Q7/D5), lote misto com composição explicada (Q6/D6), R-13 em núcleo + gatilho de 50 clientes (Q4/D7), adicional como gap de implementação (Q3/D8), adicional fora do lote com aviso (Q2/D9). R-1 e R-6 mantidos como **[GATE]** com os dois cenários descritos, aguardando o dono. R-22 restrito à opção (a) — nenhum token alterado. | @pm |
