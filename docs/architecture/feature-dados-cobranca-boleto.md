# Arquitetura — Dados de Cobrança do Pagador (habilitar emissão de boletos Cora)

**Autor:** Aria (@architect) · **Data:** 2026-07-01 · **Status:** Proposto
**Contexto:** desbloqueia a Fase 3 (emissão de boletos). Fonte: `docs/architecture.md`, `PRD §10`.

---

## 1. Problema

A emissão via `cora-gateway.ts` monta o `customer` apenas com **nome + CPF**
(`apps/web/src/server/gateway/cora-gateway.ts:147-163`). O boleto do Cora é **registrado**
e a API `POST /invoices` exige os dados completos do pagador. Ligar a flag
`GATEWAY_EMISSAO_HABILITADA=true` hoje resulta em **rejeição na primeira emissão real**.

### Campos do `customer` na API Cora vs. estado atual

| Campo Cora (`POST /invoices`) | Obrigatório | Existe hoje |
|-------------------------------|:-----------:|:-----------:|
| `name` | sim | ✅ `medicos.nome` |
| `document.identity` + `document.type` | sim | ⚠️ só CPF; sem suporte a CNPJ |
| `email` | sim | ❌ |
| `address.zip_code` (CEP) | sim | ❌ |
| `address.street` | sim | ❌ |
| `address.number` | sim | ❌ |
| `address.district` (bairro) | sim | ❌ |
| `address.city` | sim | ❌ |
| `address.state` (UF) | sim | ❌ |
| `address.complement` | não | ❌ |

---

## 2. Decisão de domínio — desacoplar identidade de pagamento

`medicos.cpf` é a **chave de cruzamento com a API da Carmem** (`GET /procedimentos?cpf=...`) e
**não pode** ser substituída por CNPJ. Porém médicos frequentemente faturam como **PJ**.

**Decisão:** manter `cpf` como identidade imutável e adicionar um **bloco de cobrança** com o
documento do pagador independente (CPF ou CNPJ). Um médico com CPF-chave pode emitir boleto no
CNPJ da sua PJ.

```
Médico
 ├─ cpf                      (INALTERADO — chave Carmem)
 └─ ...campos de faturamento (INALTERADO)

Bloco de Cobrança (novo, 1:1 com médico)
 ├─ pagador_tipo        'PF' | 'PJ'
 ├─ pagador_documento   11 dígitos (CPF) ou 14 (CNPJ)
 ├─ pagador_nome        nome ou razão social
 ├─ email               obrigatório p/ Cora
 └─ endereco: cep, logradouro, numero, complemento(opt), bairro, cidade, uf
```

### Decisão estrutural: colunas em `medicos` (não tabela separada)

Relação é estritamente 1:1 e sempre lida junto do médico → **colunas nullable em `medicos`**
(evita join a cada emissão). Detalhamento do DDL e RLS é do **@data-engineer**; abaixo o shape
de sistema.

---

## 3. Modelo de dados (shape — DDL detalhado com @data-engineer)

Nova migration `0006_dados_cobranca.sql` adiciona a `medicos` (todas nullable p/ não quebrar
registros existentes):

| Coluna | Tipo | Regra |
|--------|------|-------|
| `pagador_tipo` | text | CHECK `in ('PF','PJ')` |
| `pagador_documento` | text | dígitos; 11 se PF, 14 se PJ (CHECK) |
| `pagador_nome` | text | — |
| `email` | text | formato e-mail |
| `cep` | text | 8 dígitos |
| `logradouro` | text | — |
| `numero` | text | — |
| `complemento` | text | nullable |
| `bairro` | text | — |
| `cidade` | text | — |
| `uf` | char(2) | UF válida |

RLS: `medicos` já tem RLS (`0002_rls_policies.sql`) — endereço/e-mail são PII e ficam cobertos
pelas policies existentes (leitura autenticada, escrita admin). Sem policy nova.

### Impacto em `necessitaConfiguracao`

Hoje sinaliza médico auto-descoberto sem parâmetros de faturamento. Passa a considerar também
**dados de cobrança completos**. Um helper de domínio `cobrancaCompleta(medico): boolean`
(em `packages/shared`) centraliza a regra e é reutilizado pela UI e pelo guard de emissão.

---

## 4. Contrato compartilhado (`packages/shared`)

### `types/medico.ts` — estender `Medico`

```ts
export type PagadorTipo = 'PF' | 'PJ';

export interface DadosCobranca {
  pagadorTipo: PagadorTipo;
  pagadorDocumento: string;   // 11 (CPF) ou 14 (CNPJ) dígitos
  pagadorNome: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
}

// Campos de cobrança são opcionais no Medico (podem estar vazios até configurar).
export interface Medico { /* ...existente... */ cobranca?: DadosCobranca | null; }

/** Regra única: todos os campos obrigatórios de cobrança preenchidos. */
export function cobrancaCompleta(m: Medico): boolean { /* valida bloco */ }
```

### `types/boleto.ts` — enriquecer `DadosEmissaoBoleto`

```ts
export interface DadosEmissaoBoleto {
  execucaoResultadoId: string;
  competencia: string;
  valor: number;
  pagador: {
    nome: string;
    documento: string;        // CPF ou CNPJ (dígitos)
    tipo: 'CPF' | 'CNPJ';
    email: string;
    endereco: {
      cep: string; logradouro: string; numero: string;
      complemento: string | null; bairro: string; cidade: string; uf: string;
    };
  };
}
```

> `cpfMedico`/`nomeMedico` saem do contrato de emissão (viram `pagador.*`). O CPF-chave
> continua no `Medico`, só não é mais o que vai no boleto.

---

## 5. Gateway (`cora-gateway.ts`)

`customer` passa a montar `email` + `address` + `document.type` dinâmico:

```ts
customer: {
  name: dados.pagador.nome,
  email: dados.pagador.email,
  document: { identity: dados.pagador.documento, type: dados.pagador.tipo },
  address: {
    street: dados.pagador.endereco.logradouro,
    number: dados.pagador.endereco.numero,
    district: dados.pagador.endereco.bairro,
    city: dados.pagador.endereco.cidade,
    state: dados.pagador.endereco.uf,
    complement: dados.pagador.endereco.complemento ?? undefined,
    zip_code: dados.pagador.endereco.cep,
  },
}
```

E `payment_terms` passa a vir das **condições comerciais parametrizáveis** (§5.1), não mais
hardcoded:

```ts
payment_terms: {
  due_date: calcularVencimento(condicoes.diasVencimento),   // era fixo +30d
  fine:     condicoes.multaPercent     ? { amount: pct(condicoes.multaPercent) } : undefined,
  interest: condicoes.jurosMesPercent  ? { rate:   condicoes.jurosMesPercent }   : undefined,
  discount: condicoes.descontoPercent  ? { ... }                                 : undefined,
}
```

`mock-gateway.ts` não muda (só ecoa). Testes do cora-gateway ganham assert de `address` +
`payment_terms`.

### 5.1 Condições comerciais parametrizáveis (vencimento, multa, juros, desconto)

Termos comerciais viram **defaults globais do escritório**, configuráveis, com **override
opcional por médico**:

- Nova tabela singleton `config_cobranca`: `dias_vencimento` (default 30), `multa_percent`,
  `juros_mes_percent`, `desconto_percent`, `desconto_dias`. Escrita restrita a admin (RLS).
- `medicos` ganha overrides nullable (`dias_vencimento`, `multa_percent`, `juros_mes_percent`,
  `desconto_percent`, `desconto_dias`) — se nulos, herdam o default global.
- Resolução na emissão: `override do médico ?? default global`. Mapeado para `payment_terms` do Cora.
- UI: tela/aba de **Configurações de Cobrança** (defaults) + seção opcional no `MedicoForm`.

---

## 6. Validação (Zod) e UI

### Schema (`medico-schema.ts`)

- `dadosCobrancaSchema`: `pagadorTipo` enum; `pagadorDocumento` com refine 11/14 conforme tipo;
  `email` `.email()`; `cep` `/^\d{8}$/`; `uf` enum das 27 UFs; demais `min(1)`.
- Acoplar como bloco **opcional** em `novoMedicoSchema`/`atualizarMedicoSchema` (permite salvar
  sem cobrança e completar depois — preserva o fluxo de auto-descoberta).

### `MedicoForm`

- Nova seção **"Dados de cobrança"** (colapsável).
- **Autofill por CEP (ViaCEP)**: ao completar o CEP, busca `https://viacep.com.br/ws/{cep}/json/`
  e preenche logradouro/bairro/cidade/uf → reduz digitação e erro. Client-side, sem segredo.
- Máscara/normalização de documento conforme `pagadorTipo` (PF↔CPF, PJ↔CNPJ).

### CSV de importação (estendido)

O `parseCsv` de `/api/medicos/importar` e o modelo `medicos-modelo.csv` ganham as colunas de
cobrança (`pagador_tipo`, `pagador_documento`, `pagador_nome`, `email`, `cep`, `logradouro`,
`numero`, `complemento`, `bairro`, `cidade`, `uf`). Colunas **opcionais** — linha sem elas
importa o médico com cobrança vazia (a completar depois), preservando o fluxo atual.

---

## 7. Guard de emissão — falhar cedo (não no Cora)

Em `POST /api/boletos/emitir`, **antes** de chamar o gateway, carregar o médico do resultado e
validar `cobrancaCompleta`. Se faltar dado → `422 COBRANCA_INCOMPLETA` com a lista de campos
faltantes. Assim o erro é claro e local, nunca uma rejeição opaca do Cora.

Fluxo atualizado: `auth → flag → status 'ok' → valor>0 → **dados de cobrança completos** →
idempotência → gateway → auditoria`.

---

## 8. Estratégia de testes

| Camada | Teste |
|--------|-------|
| shared | `cobrancaCompleta` (completo, faltando campo, PF vs PJ) |
| gateway | payload Cora inclui `address` + `email` + `type` correto (CPF/CNPJ) |
| validação | Zod aceita/rejeita documento por tipo, CEP, UF, e-mail |
| rota emitir | 422 quando cobrança incompleta (mock, sem rede) |
| UI | seção de cobrança renderiza; autofill de CEP mockado |

Meta: manter a suíte verde (hoje 78 testes) e adicionar ~10.

---

## 9. Rollout

1. Migration 0006 (aditiva, nullable → zero downtime). **O dono roda manualmente** no Supabase
   (conta externa, sem acesso MCP) — o @data-engineer entrega o `.sql` pronto e revisado.
2. Deploy do contrato + gateway + validação + UI (flag `GATEWAY_EMISSAO_HABILITADA` segue `false`).
3. Preencher dados de cobrança dos médicos ativos (UI ou importação CSV estendida).
4. Validação em produção (conferência manual vs. Cora, PRD §10) → só então ligar a flag.

Compatível com os dois gates da Fase 3 (certificado mTLS + feature flag) já existentes.

---

## 10. Decisões (RESOLVIDAS — 2026-07-01)

1. **Documento do pagador:** médicos faturam como **PF (CPF) e PJ (CNPJ)** — ambos coexistem.
   → `pagadorTipo` é sempre editável, sem default forçado; validação de documento por tipo.
2. **Vencimento:** **parametrizável** → `config_cobranca.dias_vencimento` (default 30) +
   override por médico (§5.1).
3. **Multa/juros/desconto:** **incluir agora** → `payment_terms.fine/interest/discount` do Cora,
   vindos das condições comerciais parametrizáveis (§5.1).
4. **CSV de importação:** **estender** com colunas de cobrança opcionais (§6).

---

## 11. Handoff

- **@data-engineer (Dara):** migration 0006 (DDL + CHECKs + confirmar RLS).
- **@sm (River):** quebrar em stories (sugestão: 1 shared+migration, 1 gateway+guard, 1 UI+CEP, 1 testes).
- **@dev (Dex):** implementar por story.
- **@pm (Morgan):** decisões em aberto §10 com o cliente.
