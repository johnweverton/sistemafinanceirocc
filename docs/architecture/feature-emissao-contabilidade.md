# Arquitetura — Emissão de boletos para clientes de contabilidade

**Autor:** @architect (via Claude Code) · **Data:** 2026-07-24 · **Status:** Validado pelo dono — pronto para @sm quebrar em stories
**Contexto:** a empresa de contabilidade tem uma segunda carteira de cobrança, distinta da
cobrança médica (Épicos 6–10): **clientes-empresa que pagam honorários contábeis mensais**. A
regra de valor depende de como cada cliente está configurado — não do CNPJ do sistema atual —
e o dono já validou (conversa 2026-07-22/24) as regras de negócio abaixo. Este documento desenha
**onde isso entra no modelo de dados e no fluxo já existentes**, sem repetir trabalho do Épico 10.

## 0. Regras de negócio confirmadas pelo dono

1. **Modo `faixa_faturamento`** (maioria do Simples Nacional, ~80% dos casos): operador informa o
   faturamento do mês; faturamento < R$5.000,00 → boleto **R$250,00**; faturamento ≥ R$5.000,00 →
   **R$480,56**.
2. **Modo `fixo`** (Lucro Presumido + exceções do Simples Nacional, ~20% dos casos do Simples):
   valor mensal fixo por contrato, reajustado **uma vez por ano** pelo índice de valorização do
   salário mínimo (INPC + parcela do crescimento do PIB, conforme a lei do reajuste do piso).
   Reajuste decidido/aplicado em janeiro, aparece no boleto emitido em **fevereiro** (competência
   janeiro). Regra de reajuste é a mesma para Lucro Presumido e para as exceções fixas do Simples
   — **o modo de cobrança**, não o regime tributário, é o que determina o comportamento.
3. **Adicional semestral** (exceção pontual, ex.: Vital Soluções): a cada 6 meses, um **boleto
   avulso de exatos R$15.000,00**, separado do boleto mensal normal (não somado a ele).
4. Necessário: histórico do faturamento informado mês a mês, registro de todo boleto emitido, e
   visão por empresa mostrando o acumulado ao longo do tempo.

`regimeTributario` (Simples Nacional / Lucro Presumido) fica registrado como metadado
informativo/relatório — quem decide a regra de cálculo é o campo `modoCobranca`, exatamente
porque existem exceções fixas dentro do Simples Nacional (regra 2).

---

## 1. Decisões estruturais (opções e trade-offs)

### D1 — Nova tabela ou reaproveitar `empresas` (Épico 10.4)?

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (recomendada)** | Nova tabela `clientes_contabilidade`, reaproveitando os **tipos** (`DadosCobranca`, `CondicoesCobranca`, `ContaEmissora`, `RegraPreco`) mas não a tabela `empresas` | Zero acoplamento com o domínio de agregação médica (`empresa_grupo_id` em `medicos`, `execucao_resultado_contribuicoes`); schema comunica o domínio certo; `empresas` continua 100% sobre agregação de guias por empresa | Mais uma tabela + repository + rotas (mas é o mesmo padrão já replicado 2x — médico, empresa) |
| B | Reaproveitar `empresas`, acrescentando `tipo: 'agregacao_medica' \| 'contabilidade'` + campos de faturamento/regime | Uma tabela a menos | `empresas` é literalmente "quem agrega produção de médicos" (comentário da migration 0028); um cliente contábil não agrega ninguém — FKs (`empresa_grupo_id`, `execucao_resultado_contribuicoes`) ficariam sempre nulos/sem sentido pra essa linha; mistura dois domínios que só coincidem por acaso ("pagador PJ com boleto") |
| C | Tabela genérica `pagadores` cobrindo médico+empresa+contabilidade | Unificação máxima | Reescreve o Épico 10 inteiro; risco alto, sem necessidade — os domínios têm ciclos de vida e regras de preço muito diferentes |

**Decisão proposta: A.** O princípio REUSE>ADAPT>CREATE se aplica aos **tipos de domínio**
(`DadosCobranca` etc.), não à tabela `empresas`, cujo propósito é especificamente agregação
médico→empresa. Criar uma tabela nova aqui é a aplicação correta do princípio "Zero Coupling":
o vínculo errado (reaproveitar `empresas`) criaria acoplamento entre dois domínios que não têm
nada em comum além do formato do pagador.

### D2 — Onde entra o cálculo `faixa_faturamento`?

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (recomendada)** | Estender `RegraPrecoForma` com `'faixa_faturamento'` + 2 campos novos em `RegraPreco` (`valorAbaixoLimiar`, `valorAcimaLimiar`), reaproveitando o campo `limiar` já existente para o corte de R$5.000 | Um único conceito de "regra de preço" no sistema inteiro (médico, empresa, cliente contábil); reaproveita Zod/CHECK/`aplicarRegraPreco`/mapper — zero duplicação | `RegraPreco` (tipo compartilhado por médico e empresa) ganha 2 campos que só fazem sentido numa forma — mas já é assim hoje (`base`/`limiar` só valem para `base_excedente`) |
| B | Regra de preço separada, só para cliente contábil | Isola o cliente contábil de qualquer mudança futura em médico/empresa | Duplica Zod, CHECK, mapper e a função `aplicarRegraPreco` inteira pra uma lógica quase idêntica |

**Decisão proposta: A.** Mesmo padrão já usado 2x nas Stories 10.1/10.4b — extrair para reuso.

### D3 — Pipeline de emissão: reaproveitar `execucoes → execucao_resultados → boletos` ou criar um novo?

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (recomendada)** | Estender o mesmo trio (`execucoes.cliente_contabilidade_id`, `execucao_resultados.cliente_contabilidade_id`, CHECK de exclusão mútua a 3 vias) — mesmo padrão que a 10.4b já fez para `empresa_id` | Reaproveita 100% o gateway Cora, idempotência (`buscarBoletoEmitido`), feature flag, auditoria (`boletos`), multi-conta emissora (Épico 7) e a tela de emissão — nada disso precisa ser reescrito | `execucao_resultados` acumula um 3º FK opcional (mas o padrão de CHECK "nunca dois setados" já foi validado na 10.4b e é extensível) |
| B | Pipeline de emissão paralelo, próprio para contabilidade | Isolamento total | Reescreve gateway Cora, idempotência, feature flag e auditoria — meses de trabalho sem necessidade; viola "nunca perder capacidade" ao criar um segundo caminho de emissão para manter em paralelo |

**Decisão proposta: A.** `boletos.execucao_resultado_id` já é agnóstico à origem — não muda nada
nessa tabela. Só o branch de resolução do pagador em
`apps/web/src/app/api/boletos/emitir/route.ts:132-152` ganha um 3º `else if`.

### D4 — Como modelar o adicional semestral (R$15.000 avulso)?

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (recomendada)** | Reaproveita o mesmo pipeline: uma 2ª `execucao` no mês do ciclo, com `execucoes.eh_adicional = true`, `regraPreco` inline `{forma:'fixo', valorFixo: adicional_valor}` — gera seu próprio `execucao_resultados` e seu próprio boleto, sem tocar no resultado mensal | Reaproveita idempotência (chave é `execucao_resultado_id`, não competência — 2 resultados no mesmo mês para o mesmo cliente convivem sem conflito, já testado no fluxo atual); nenhuma tabela nova | `execucoes` ganha 1 coluna booleana nova (`eh_adicional`, default `false` — não afeta médico/empresa) |
| B | Tabela separada `cobrancas_avulsas` com emissão própria | Isolamento total do conceito "avulso" | Duplica gateway/idempotência/auditoria de novo — mesmo problema do D3-B |

**Decisão proposta: A.** Confirmado pelo dono: "a cada 6 meses o boleto é emitido com o valor de
15 mil, **apenas** 15 mil" — ou seja, um boleto normal (mesmo pipeline), só que com valor e
cadência diferentes do mensal.

### D5 — Reajuste anual: automatizado ou manual?

| Opção | Descrição | Prós | Contras |
|-------|-----------|------|---------|
| **A (recomendada)** | Manual: em janeiro, admin edita `clientes_contabilidade.valor_fixo` (mesmo formulário de cadastro), motivo obrigatório citando o índice/percentual do ano — reaproveita 100% o histórico de auditoria (`clientes_contabilidade_historico`, mesmo padrão de `medicos_historico`/`empresas_historico`) | Zero mecanismo novo; o índice de reajuste do salário mínimo é publicado por lei uma vez por ano — não há API confiável para automatizar, e automatizar 1 evento/ano é engenharia desnecessária | Depende de alguém lembrar de aplicar em janeiro |
| B | Sistema calcula automaticamente buscando o índice publicado | "Nunca esquece" | Não existe fonte oficial estável/API para consumir; a lei do salário mínimo é publicada por decreto, valor sai perto da virada do ano — automação seria frágil e sem ganho real para algo que acontece 1x/ano |

**Decisão proposta: A.** Mitigação do "esquecer": UI mostra um aviso em janeiro/fevereiro listando
clientes `modoCobranca='fixo'` sem alteração de `valor_fixo` desde o ano anterior (consulta simples
sobre `clientes_contabilidade_historico`, sem mecanismo de agendamento).

---

## 2. Modelo de dados

### 2.1 Tipos (`packages/shared`)

```ts
// packages/shared/src/types/medico.ts — ADAPT (extensão, não quebra médico/empresa existentes)
export type RegraPrecoForma = 'por_guia' | 'base_excedente' | 'fixo' | 'faixa_faturamento';

export interface RegraPreco {
  forma: RegraPrecoForma;
  base: number | null;
  limiar: number | null;          // reaproveitado: corte de faturamento em 'faixa_faturamento'
  taxa: number | null;
  valorFixo: number | null;
  valorAbaixoLimiar: number | null;  // NOVO — só 'faixa_faturamento'
  valorAcimaLimiar: number | null;   // NOVO — só 'faixa_faturamento'
}
```

```ts
// packages/shared/src/types/cliente-contabilidade.ts — NOVO
import type { ContaEmissora } from './conta-emissora';
import type { DadosCobranca, CondicoesCobranca, RegraPreco } from './medico';

export type RegimeTributario = 'simples_nacional' | 'lucro_presumido';
export type ModoCobrancaContabilidade = 'faixa_faturamento' | 'fixo';

export interface ClienteContabilidade {
  id: string;
  nome: string;
  regimeTributario: RegimeTributario;   // informativo/relatório
  modoCobranca: ModoCobrancaContabilidade;   // decide a regra de cálculo
  regraPreco: RegraPreco | null;        // usado quando modoCobranca = 'faixa_faturamento' ou 'fixo'
  cobranca: DadosCobranca | null;
  contaEmissora: ContaEmissora;
  condicoes: CondicoesCobranca | null;
  adicionalAtivo: boolean;
  adicionalValor: number | null;        // ex.: 15000.00
  adicionalIntervaloMeses: number | null; // ex.: 6
  adicionalCompetenciaBase: string | null; // 'YYYY-MM' — 1ª competência do ciclo
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClienteContabilidadeHistorico { /* mesmo formato de EmpresaHistorico */ }

export interface ClienteContabilidadeFaturamento {
  id: string;
  clienteContabilidadeId: string;
  competencia: string;      // 'YYYY-MM'
  faturamento: number;
  informadoPor: string;     // profiles.id
  informadoEm: string;
}
```

### 2.2 Migration (nova, ex. `0030_clientes_contabilidade.sql`)

```sql
-- 1. clientes_contabilidade (mesmo padrão de colunas achatadas de empresas/medicos)
create table clientes_contabilidade (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  regime_tributario text not null check (regime_tributario in ('simples_nacional','lucro_presumido')),
  modo_cobranca text not null check (modo_cobranca in ('faixa_faturamento','fixo')),

  -- regra de preço (reaproveita o domínio RegraPreco — migrations 0025/0027/0028 como referência)
  regra_preco_forma text,
  regra_preco_base numeric(10,2),
  regra_preco_limiar numeric(10,2),
  regra_preco_taxa numeric(10,2),
  regra_preco_valor_fixo numeric(10,2),
  regra_preco_valor_abaixo_limiar numeric(10,2),
  regra_preco_valor_acima_limiar numeric(10,2),

  -- cobrança (mesmo formato de empresas — migration 0028)
  pagador_tipo text, pagador_documento text, pagador_nome text, email text, whatsapp text,
  cep text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text,
  conta_emissora text not null default 'mc',
  dias_vencimento integer, multa_percent numeric(5,2), juros_mes_percent numeric(5,2),
  desconto_percent numeric(5,2), desconto_dias integer,

  -- adicional semestral
  adicional_ativo boolean not null default false,
  adicional_valor numeric(10,2),
  adicional_intervalo_meses integer,
  adicional_competencia_base text, -- 'YYYY-MM'

  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- CHECKs de coerência por modo_cobranca/forma (padrão drop+add idempotente, igual 0028)
-- CHECK: adicional_ativo => adicional_valor/intervalo/competencia_base todos not null

-- 2. clientes_contabilidade_historico — mesmo padrão de empresas_historico

-- 3. clientes_contabilidade_faturamentos
create table clientes_contabilidade_faturamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_contabilidade_id uuid not null references clientes_contabilidade(id),
  competencia text not null,
  faturamento numeric(12,2) not null,
  informado_por uuid not null references profiles(id),
  informado_em timestamptz not null default now(),
  unique (cliente_contabilidade_id, competencia)
);

-- 4. Extensão de execucoes / execucao_resultados (mesmo padrão da migration 0029)
alter table execucoes add column cliente_contabilidade_id uuid references clientes_contabilidade(id);
alter table execucoes add column eh_adicional boolean not null default false;

alter table execucao_resultados add column cliente_contabilidade_id uuid references clientes_contabilidade(id);
-- CHECK estendida a 3 vias (nunca 2 dos 3 setados ao mesmo tempo), mesmo espírito da 0029
```

### 2.3 Engine (funções puras, sem I/O)

- `aplicarRegraPreco` (`apps/web/src/server/engine/regra-preco.ts`) ganha o branch
  `forma === 'faixa_faturamento'`: `faturamento >= regra.limiar ? valorAcimaLimiar : valorAbaixoLimiar`.
  Renomear o parâmetro `guias` → `quantidade` (cosmético, já que agora representa guias OU
  faturamento conforme o chamador).
- `processar-cliente-contabilidade.ts` (novo, espelha `processar-empresa.ts`): dado
  `modoCobranca`, busca o faturamento lançado da competência (`faixa_faturamento`) ou usa
  `regraPreco.valorFixo` direto (`fixo`); se `ehAdicional`, ignora tudo isso e aplica
  `{forma:'fixo', valorFixo: adicionalValor}` inline.

### 2.4 Rotas

- `GET/POST /api/clientes-contabilidade`, `GET/PATCH/DELETE /api/clientes-contabilidade/[id]`,
  `GET /api/clientes-contabilidade/[id]/historico` — mesmo padrão de `/api/empresas`.
- `POST /api/clientes-contabilidade/[id]/faturamentos` + `GET .../faturamentos` — lançar/listar
  faturamento mensal.
- `/api/execucoes` (rota existente) ganha suporte a `clienteContabilidadeId` + `ehAdicional`, mesmo
  padrão do branch `empresaId` já existente.
- `/api/boletos/emitir/route.ts:132` ganha `else if (resultadoRow.cliente_contabilidade_id)`,
  buscando `clientes_contabilidade` para montar o pagador — reaproveita `cobrancaMinimaEmissao`
  por tipagem estrutural, sem mudança na função.

### 2.5 UI

- `/clientes-contabilidade` — cadastro (CRUD), reaproveitando os blocos de `EmpresaForm.tsx`
  (cobrança, condições, conta emissora) + campos próprios (regime, modo, regra, adicional).
- `/clientes-contabilidade/[id]` — histórico de faturamento mês a mês + execuções/boletos emitidos
  (reaproveita `HistoricoTimeline.tsx`).
- Tela "Lançar faturamento do mês": lista clientes `faixa_faturamento` pendentes na competência,
  campo de faturamento com preview do valor calculado antes de confirmar.
- Tela de execução para clientes `fixo`: sem input, confirma direto com `valor_fixo` do cadastro.
- Aviso "adicional semestral vencendo" quando a competência atual bate o ciclo
  (`adicional_competencia_base` + `adicional_intervalo_meses`).
- Aviso "reajuste anual pendente" (jan/fev) para clientes `fixo` sem alteração de `valor_fixo`
  desde o ano anterior.

---

## 3. Reuso vs. Criação (IDS)

| Reaproveitado (sem mudar) | Adaptado (extensão aditiva) | Criado |
|---|---|---|
| `DadosCobranca`, `CondicoesCobranca`, `ContaEmissora`, `cobrancaMinimaEmissao`/`cobrancaCompleta`, gateway Cora, idempotência de emissão, feature flag, multi-conta (Épico 7) | `RegraPrecoForma`/`RegraPreco` (+`faixa_faturamento`, +2 campos), `execucoes`/`execucao_resultados` (+`cliente_contabilidade_id`, +`eh_adicional`, CHECK a 3 vias), `aplicarRegraPreco` (+1 branch) | `clientes_contabilidade`, `clientes_contabilidade_historico`, `clientes_contabilidade_faturamentos`, `processar-cliente-contabilidade.ts`, rotas/UI de clientes contábeis |

---

## 4. Riscos

- **CHECK de exclusão mútua a 3 vias** em `execucao_resultados` precisa do mesmo cuidado que a
  10.4b teve com dados legados (medico_id nullable) — replicar o padrão "nunca dois setados",
  não XOR estrito.
- **Faturamento não lançado**: se a competência chegar sem faturamento informado para um cliente
  `faixa_faturamento`, o processamento deve gerar `status: 'alerta'` (nunca chutar valor) — mesmo
  princípio de `aplicarRegraPreco` hoje.
- **Reajuste esquecido**: mitigado pelo aviso de UI (D5), não por automação.
- **Nome da entidade**: `clientes_contabilidade` (confirmado pelo dono 2026-07-24) — não colide
  semanticamente com `empresas` (Épico 10.4, que é sobre agregação médica).

---

## 5. Split de stories proposto (para @sm)

Espelhando o padrão que funcionou no Épico 10.4 (a/b/c):

- **11.1 — Cadastro de clientes contábeis**: tabela, tipos, Zod, CRUD, UI de cadastro. Sem
  execução/faturamento ainda.
- **11.2 — Lançamento de faturamento e regra `faixa_faturamento`**: tabela de faturamentos,
  extensão de `RegraPreco`, branch em `aplicarRegraPreco`, tela de lançamento.
- **11.3 — Execução e emissão de boleto (mensal + fixo)**: extensão de `execucoes`/
  `execucao_resultados`, `processar-cliente-contabilidade.ts`, branch em `/api/boletos/emitir`.
- **11.4 — Adicional semestral**: `eh_adicional`, fluxo de geração do boleto avulso, aviso de
  ciclo vencendo.
- **11.5 — Histórico e relatório por cliente**: página de detalhe, timeline, aviso de reajuste
  pendente.

**DoD deste documento:** ✅ validado pelo dono nas 5 decisões (D1–D5) e no nome da entidade
(2026-07-24). Próximo passo: @sm quebra em stories com ACs testáveis a partir deste desenho,
@po valida cada uma antes de @dev iniciar.

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-07-24 | 0.1 | Desenho inicial a partir dos requisitos ditados pelo dono (2026-07-22/24) e das respostas às perguntas de esclarecimento (limite R$5.000, índice de reajuste, formato do adicional semestral, exceções fixas dentro do Simples Nacional). Aguardando validação do dono nas decisões D1–D5. | @architect |
| 2026-07-24 | 0.2 | Dono validou as decisões D1–D5 e definiu o nome da entidade como `clientes_contabilidade` (em vez de `clientes_contabeis`). Status → Validado, pronto para @sm. | @architect |
