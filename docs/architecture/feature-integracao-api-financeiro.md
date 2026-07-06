# Arquitetura — Integração com a API real do Sistema Web (médicos + produções)

**Autor:** Aria (@architect) · **Data:** 2026-07-06 · **Status:** Proposto
**Contexto:** fonte de verdade do **Épico 5** (`docs/stories/README.md`). Contrato externo
versionado em `docs/integracao/api-financeiro-sistema-web.md`. Docs relacionados:
`feature-dados-cobranca-boleto.md` (Épico 3), `feature-ciclo-financeiro.md` (Épico 4).

---

## 1. Problema e objetivo

O sistema foi construído sobre um contrato **presumido** com a API da Carmem (PRD §6.4):
`GET /api/procedimentos?cpf=&competencia=` com campos `numero_atendimento`/`senha_procedimento`.
A API **real** entregue pelo programador é outra: `fin-clientes` (médicos **sem CPF e sem
especialidade**) → `fin-producoes?clienteId=` (produções **nomeadas**, ex. "Janeiro 2026") →
`fin-itens?producaoId=` (itens com `via_acesso`/`status`/`patient_name`, **sem** número de
atendimento nem senha).

Isso quebra três suposições estruturais:

1. **Chave de cruzamento:** era CPF; a origem só oferece UUID próprio (`external_id`).
2. **Unidade de busca:** era `(cpf, competência)`; a origem trabalha com `(cliente, produção)`.
3. **Regra de contagem:** o engine (`contagem.ts`, porte 1:1 do `motor_guias_v2.py`) filtra por
   `numeroAtendimento`+`senha` e agrupa por `(atendimento, data)` — campos que não existem mais.

Objetivo: adaptar a camada de integração, a descoberta/sincronização de médicos, o motor de
contagem e o fluxo de execução para o contrato real — preservando o Engine como função pura e o
restante do ciclo (preços internos, boletos, baixa, dashboard) **intacto**.

---

## 2. Decisões fechadas (dono, 2026-07-06 — ver Épico 5 §Decisões)

1. Médico importado nasce **incompleto** (`necessitaConfiguracao=true`); guard 422 já bloqueia emissão.
2. UI de **pendências de cadastro** via `cobrancaCompleta()`; completude por MedicoForm/ViaCEP.
3. CSV estendido (story 3.4) segue como completude **em massa**.
4. **`external_id`** (UUID da origem) é a chave de vínculo permanente; CPF na API foi pedido ao
   programador — não bloquear.
5. **Todas as guias contam**, independente do `status` da origem; única regra especial é o
   agrupamento por `via_acesso`.
6. Credenciais só em ambiente: `API_FINANCEIRO_URL` / `API_FINANCEIRO_KEY`.
7. **Seleção manual da produção** na execução (sem mapeamento automático nome↔competência).
8. **Preço segue interno** (`precos.ts`); `charged_val`/`paid_val` apenas informativos.
9. **Matching assistido** na carga inicial (sugere pares por similaridade de nome; usuário confirma).
10. `production_type` **deriva** `statusHapvida` (Credenciada→`credenciado`; VH→`nao_credenciado`,
    mapeamento do VH a confirmar — §10).

---

## 3. Decisões de arquitetura desta feature

### 3.1 Substituição, não convivência
O contrato presumido **nunca existiu em produção** (`PROCEDIMENTOS_SOURCE=http` nunca ligado).
O client atual (`procedimentos-client.ts`, modo http) e o endpoint de descoberta por CPF são
**código morto de um contrato imaginário** — serão substituídos pelo client real, não mantidos em
paralelo. O modo `local` (fixtures) **permanece** como fallback de dev/teste, agora produzindo o
novo tipo de transporte.

### 3.2 Novo tipo de transporte: `ItemProducao` (anti-corrupção)
`Procedimento` (transporte atual) modela o contrato presumido. Criar `ItemProducao` em
`packages/shared` espelhando o contrato real, com normalização defensiva no client (strings de
data cortadas em 10 chars, números validados, `via_acesso` normalizado para boolean):

```ts
interface ItemProducao {
  data: string;              // YYYY-MM-DD (date)
  pacienteNome: string;      // patient_name
  atendimentoExternoId: string | null; // senha OU nº de atendimento — campo PEDIDO ao
                             // programador (2026-07-06); null até a origem entregar
  codigoProcedimento: string;// proc_code (TUSS)
  descricaoProcedimento: string | null; // proc_name
  statusOrigem: string;      // status — informativo, NÃO filtra contagem (decisão 5)
  viaAcesso: boolean;        // via_acesso === "Sim"
  tipoAto: string | null;    // act_type
  valorCobradoOrigem: number | null; // charged_val — informativo (decisão 8)
  valorPagoOrigem: number | null;    // paid_val — informativo (decisão 8)
}
```

`Procedimento` é removido junto com o caminho http antigo quando a story 5.5 concluir o cutover
(fixtures locais migram para `ItemProducao` na 5.1).

### 3.3 Q2 resolvida — regra de contagem sob a semântica real

O engine ganha um módulo novo (`contagem-producao.ts`), função pura, sem tocar no ciclo de preços:

- **Linha válida:** `data` e `pacienteNome` presentes (substitui o filtro atendimento+senha).
  `statusOrigem` **nunca** filtra (decisão 5). Linha inválida vira alerta de conferência, não erro.
- **Agrupamento:** a chave do atendimento é `atendimentoExternoId` quando presente;
  **fallback** `(pacienteNome, data)` enquanto a origem não entregar o campo (§10.3 — o dono
  confirmou que um paciente PODE ter dois atendimentos no mesmo dia, então o fallback
  **subconta** nesse caso raro; a chave definitiva corrige). Itens com `viaAcesso=true` agrupam
  por essa chave e cada grupo = **1 guia**. Itens com `viaAcesso=false` = **1 guia cada**.
- **Cirurgias:** número de grupos `viaAcesso` distintos (o análogo real de "atendimentos").
- **`detectarModo` v2:** grupo `viaAcesso` do mesmo paciente com itens em **mais de uma data**
  → modo observado `'sim'` (mantém a trava de conferência `modoMudancaData` do PRD §5.3).
- **Consolidado v2 (informativo):** agrupamento `viaAcesso` ignorando a data (só paciente) —
  mostra a diferença vs. contagem por data, espelhando o papel de `consolidarPorAtendimento`.
- **Pediatra (teto n/3): regra MANTIDA** (dono, 2026-07-06 — via de acesso é coisa distinta da
  regra do pediatra). Ordem de aplicação: itens com `viaAcesso=true` agrupam primeiro
  (1 guia por grupo, independente de especialidade); para **pediatra**, os itens restantes
  (sem via de acesso) agrupam por `(pacienteNome, data)` — proxy do antigo
  `(numeroAtendimento, data)` — e cada balde vira `teto(n/3)` guias. Não-pediatra: 1 guia por
  item restante. Casos de ouro da story 5.3 validam a interação das duas regras com o dono.

As funções atuais (`contarGuias`, `consolidarPorAtendimento`, `detectarModo`,
`procedimentosValidos`) permanecem até o cutover da 5.5, garantindo que nada do fluxo CSV/fixtures
quebre durante o épico.

### 3.4 CPF deixa de ser chave interna (passa a dado cadastral)
`fin-clientes` não traz CPF, e hoje ele é chave em `execucao_resultados.cpf`,
`guiasExecucaoAnterior(cpf)` e na descoberta. Decisão: **a chave interna passa a ser `medico.id`**
(o vínculo com a origem é `medicos.external_id`). CPF vira dado cadastral obrigatório para
**completude** (pendências), não para **processamento**:

- `medicos.cpf` → nullable com UNIQUE parcial (`WHERE cpf IS NOT NULL`) — DDL com @data-engineer.
- `execucao_resultados` ganha acesso por `medico_id` (já existe a coluna); `cpf` no resultado passa
  a snapshot informativo (pode ser vazio para médico ainda sem CPF).
- `guiasExecucaoAnterior` passa a consultar por `medico_id`.
- Quando o CPF chegar na API (pedido feito), ele volta como **verificação** do vínculo, não chave.

### 3.5 Fluxo de execução: seleção manual de produção (decisão 7)
A execução deixa de ser "competência → busca automática por CPF" e ganha um passo de preparação:

```
Tela Nova Execução
  1. usuário informa a competência (como hoje)
  2. sistema lista médicos ativos vinculados (external_id) e, por médico,
     as produções da API (GET fin-producoes) num dropdown
     — pré-seleção por casamento de nome quando inequívoco ("Janeiro 2026" ↔ 2026-01),
       sempre editável (a escolha final é do usuário — decisão 7)
  3. médico sem produção escolhida fica FORA da execução (vira 'sem_dados')
  4. POST /api/execucoes { competencia, selecoes: [{ medicoId, producaoExternaId, producaoNome }] }
```

O orchestrator preserva o desenho de lotes encadeados (BATCH_SIZE 20, X-Internal-Secret): muda a
unidade de busca — `buscarItens(producaoExternaId)` em vez de `buscarProcedimentos(cpf, competencia)`.
As seleções são persistidas com a execução (auditoria: qual produção alimentou qual resultado).

### 3.6 Sincronização de médicos (descoberta nova)
A descoberta por competência morre com o contrato presumido. Nasce a **sincronização** explícita
(botão na tela de médicos, e opcionalmente no passo 2 da execução):

```
GET fin-clientes → para cada cliente da origem:
  - já vinculado (external_id)      → atualiza nome/production_type→statusHapvida (decisão 10)
  - não vinculado                   → matching assistido (decisão 9):
      sugestão por similaridade de nome (normalização: caixa/acentos/abreviações)
      · usuário CONFIRMA o par  → grava external_id no médico existente
      · usuário REJEITA/sem par → cria médico novo: external_id, nome, statusHapvida derivado,
                                  cpf NULL, necessitaConfiguracao=true (decisão 1)
```

Nenhum médico é criado ou vinculado sem confirmação do usuário na carga inicial (o vínculo é
permanente; erro aqui contamina histórico e cobrança).

---

## 4. Modelo de dados (shape — DDL detalhado com @data-engineer)

Migration `0011_integracao_api_financeiro.sql`:

| Mudança | Regra |
|---------|-------|
| `medicos.external_id` uuid UNIQUE nullable | vínculo permanente com `fin-clientes.id` |
| `medicos.cpf` → nullable | UNIQUE parcial `WHERE cpf IS NOT NULL`; CHECKs existentes preservados |
| `execucoes.selecoes` jsonb (ou tabela `execucao_selecoes`) | snapshot `[{medico_id, producao_externa_id, producao_nome}]` — auditoria da decisão 7; forma final com @data-engineer |
| `execucao_resultados.cpf` | passa a aceitar vazio (snapshot informativo — §3.4) |

RLS inalterada (mesmos papéis das tabelas hoje). Sem nova PII além do que já existe
(`patient_name` **não é persistido** — `ItemProducao` vive só em memória, como `Procedimento` hoje).

---

## 5. Backend

### 5.1 Client da API real — `fin-api-client.ts`
Único ponto que fala com a origem (substitui `procedimentos-client.ts`):

- `listarClientes(): Promise<ClienteExterno[]>` — GET `/api/fin-clientes`
- `listarProducoes(clienteExternoId): Promise<ProducaoExterna[]>` — GET `/api/fin-producoes`
- `buscarItens(producaoExternaId): Promise<ItemProducao[]>` — GET `/api/fin-itens`

Padrões herdados do client atual (mantidos por já estarem calibrados): timeout 30s,
retry ×3 com backoff exponencial **só para 5xx/rede**; 401 → `ApiError 502 FIN_API_401`
imediato; 4xx sem retry; resposta não-array → `FIN_API_FORMATO`; array vazio é caminho
válido (`sem_dados`). Header `x-api-key` com `API_FINANCEIRO_KEY`.

Modo `local` (fixtures) preservado via `PROCEDIMENTOS_SOURCE` (renomear para `FIN_API_SOURCE`
na 5.1), agora servindo `ItemProducao`.

### 5.2 Sincronização — `medico-sync.ts` + rotas
- `POST /api/medicos/sincronizar` — dispara a sincronização (§3.6); responde pendências de matching.
- `POST /api/medicos/[id]/vincular` — confirma par sugerido (grava `external_id`).
- Repositório: `vincularExternalId`, `buscarPorExternalId`, `criarMedicoExterno`.
- Similaridade de nome: normalização (minúsculas, sem acentos, sem títulos "dr/dra") +
  comparação por tokens — **sem dependência nova**; empate/ambiguidade nunca decide sozinho.

### 5.3 Orchestrator
- `iniciarExecucao(competencia, usuarioId, selecoes)` — valida seleções (médico ativo + vinculado),
  persiste snapshot, total = seleções.
- `processarUmMedico` → `processarSelecao`: `buscarItens(producaoExternaId)` + engine novo +
  `gravarResultado(medico_id, ...)`. Falha de rede segue virando alerta sem derrubar o lote.
- Fase de descoberta automática silenciosa é **removida** (substituída pela sincronização explícita).

### 5.4 Env
| Variável | Uso |
|----------|-----|
| `API_FINANCEIRO_URL` | base da API do sistema web (substitui `CARMEM_API_URL`) |
| `API_FINANCEIRO_KEY` | chave `x-api-key` (substitui `CARMEM_API_KEY`) |
| `FIN_API_SOURCE` | `local` (fixtures) \| `http` (renomeia `PROCEDIMENTOS_SOURCE`) |

---

## 6. Frontend

- **Tela Nova Execução** (§3.5): competência + tabela médico→produção (dropdown), pré-seleção
  editável, resumo antes de iniciar. Estados: médico sem vínculo (link para sincronizar),
  API fora do ar (erro claro, execução não inicia).
- **Pendências de cadastro** (decisão 2): filtro/badge "incompleto" na lista de médicos —
  critérios: `cpf IS NULL` · `especialidade IS NULL` · `!cobrancaCompleta()` · `sem external_id`.
  Cada pendência linka para o MedicoForm na seção correspondente.
- **Matching assistido** (decisão 9): tela/modal de sincronização com pares sugeridos
  (origem ↔ cadastro), ações confirmar/rejeitar/criar novo.
- Reuso do design system atual (cards, tabular mono, badges); refino com @ux-design-expert se preciso.

---

## 7. Segurança
- Chave da API **só server-side** (route handlers/orchestrator); nunca exposta ao browser,
  nunca versionada (decisão 6). `.env.local` + painel Vercel.
- Chamadas de saída com timeout/retry limitados (§5.1) — a origem fora do ar não trava execução
  (alerta por médico, padrão atual preservado).
- `patient_name` (PII de terceiros) **não persiste** — transporte em memória apenas (§4).
- Rotas novas (`sincronizar`, `vincular`, execuções) exigem papel `admin`/`financeiro` como as atuais.
- Nada muda no middleware: nenhuma rota pública nova.

---

## 8. NFR
- **Volume real:** ~120 médicos/competência. Tela de execução: 1×`fin-clientes` +
  N×`fin-producoes` (paralelizável com limite de concorrência ~8 → poucos segundos).
  Execução: 1×`fin-itens` por seleção, dentro dos lotes de 20 já calibrados (60s maxDuration).
- **Resiliência:** padrões de retry/timeout herdados; falha por médico → alerta isolado.
- **Auditoria:** snapshot de seleções por execução (§4) responde "qual produção gerou este resultado".
- **Paridade:** suíte do engine novo com casos de ouro derivados do contrato
  (`via_acesso` multi-data, paciente repetido sem via_acesso, status Glosado/Recurso contando).

---

## 9. Faseamento e stories (refina a tabela do Épico 5)

| # | Story | Depende de | Conteúdo |
|---|-------|-----------|----------|
| 5.1 | Client real + tipos + env | migration 0011 | `fin-api-client.ts`, `ItemProducao`, fixtures novas, `FIN_API_SOURCE`, env |
| 5.2 | Sincronização + matching assistido (backend) | 5.1 | `medico-sync.ts`, rotas sincronizar/vincular, repositório, derivação statusHapvida |
| 5.3 | Engine: contagem por `via_acesso` | 5.1 | `contagem-producao.ts` puro + testes de ouro (§3.3) |
| 5.4 | UI: pendências + matching | 5.2 | badge/filtro incompleto, modal de sincronização |
| 5.5 | Execução por produção (cutover) | 5.2, 5.3 | tela Nova Execução, orchestrator por seleção, remoção do contrato presumido e de `Procedimento` |

Migration 0011 é pré-requisito operacional (dono roda manualmente no Supabase, padrão dos épicos
anteriores). 5.3 e 5.2 paralelizáveis após 5.1; 5.4 após 5.2; 5.5 fecha e faz a limpeza.

---

## 10. Decisões em aberto (para o dono/negócio)
1. ~~**Pediatra (teto n/3)**~~ **RESOLVIDA (2026-07-06):** regra mantida — via de acesso é
   independente da regra do pediatra. Interação das duas regras especificada no §3.3.
2. ~~**Mapeamento do VH**~~ **RESOLVIDA (2026-07-06):** confirmado "Produção VH" → `nao_credenciado`.
3. ~~**Chave do grupo (paciente, data)**~~ **RESOLVIDA (2026-07-06):** o dono confirmou que
   acontece (mesmo paciente, dois atendimentos no mesmo dia) e **pediu ao programador** a senha
   OU o nº de atendimento no `fin-itens`. Arquitetura já modela `atendimentoExternoId`
   (nullable) com fallback (paciente, data) — §3.2/§3.3. **Pendência externa:** quando a origem
   entregar, atualizar `docs/integracao/api-financeiro-sistema-web.md` e ativar a chave
   definitiva. O cutover (5.5) deve preferencialmente esperar esse campo, pois o fallback
   subconta guias no caso confirmado.

---

## 11. Handoff
- **@data-engineer (Dara):** migration 0011 (§4) — `external_id`, `cpf` nullable + UNIQUE parcial,
  snapshot de seleções; revisar impacto em views/RPCs que usam `cpf` (recebíveis/dashboard).
- **@sm (River):** detalhar stories 5.1–5.5 (§9).
- **@dev (Dex):** implementar por story.
- **@pm (Morgan):** fechar §10 com o dono e com o programador da origem (CPF + campo de agrupamento).
- **@devops (Gage):** configurar `API_FINANCEIRO_URL`/`API_FINANCEIRO_KEY` no Vercel quando a 5.1 entrar.
