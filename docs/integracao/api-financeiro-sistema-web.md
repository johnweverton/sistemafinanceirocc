# API de Integração — Sistema Financeiro

Documentação dos endpoints disponibilizados pelo **Sistema Web (Carmem Cavalcante)** para consulta de dados de produção médica.

---

## Configuração inicial

### URL base

```
https://<domínio-vercel-do-sistema-web>
```

> Solicite a URL exata e a chave de API ao responsável pelo sistema web.

### Autenticação

Todos os endpoints exigem uma **API Key** no cabeçalho de cada requisição:

```
x-api-key: <sua-chave-secreta>
```

Sem esse cabeçalho (ou com chave errada), a API retorna **401 Não autorizado**.

### Formato

- Todas as respostas são `Content-Type: application/json`
- Datas no formato `YYYY-MM-DD` (ISO 8601)
- Valores monetários como `number` (ponto flutuante, ex: `150.50`)

---

## Endpoints

### 1. Listar médicos

Retorna todos os médicos cadastrados, ordenados por nome.

```
GET /api/fin-clientes
```

**Cabeçalhos:**
```
x-api-key: <chave>
```

**Resposta 200:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Dr. João Silva",
    "cpf": "12345678900",
    "production_type": "Produção Credenciada"
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Dra. Maria Souza",
    "cpf": "98765432100",
    "production_type": "Produção VH"
  }
]
```

**Campos:**

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string (UUID) | Identificador único do médico |
| `name` | string | Nome completo do médico |
| `cpf` | string \| null | CPF do médico, somente dígitos (sem pontuação) — útil como parâmetro de conferência |
| `production_type` | string | `"Produção Credenciada"` ou `"Produção VH"` |

---

### 2. Listar produções de um médico

Retorna todas as produções de um médico específico, na ordem cadastrada no sistema.

```
GET /api/fin-producoes?clienteId=<id>
```

**Parâmetros de query:**

| Parâmetro | Obrigatório | Descrição |
|---|---|---|
| `clienteId` | Sim | UUID do médico (obtido em `/api/fin-clientes`) |

**Resposta 200:**
```json
[
  {
    "id": "661e9511-f30c-52e5-b827-557766551111",
    "name": "Janeiro 2026"
  },
  {
    "id": "661e9511-f30c-52e5-b827-557766552222",
    "name": "Fevereiro 2026"
  }
]
```

**Campos:**

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string (UUID) | Identificador único da produção |
| `name` | string | Nome da produção (ex: "Janeiro 2026") |

---

### 3. Listar itens de uma produção

Retorna todos os itens (procedimentos) de uma produção, ordenados por nome do paciente e data. Suporta produções com mais de 1000 itens automaticamente.

```
GET /api/fin-itens?producaoId=<id>
```

**Parâmetros de query:**

| Parâmetro | Obrigatório | Descrição |
|---|---|---|
| `producaoId` | Sim | UUID da produção (obtido em `/api/fin-producoes`) |

**Resposta 200:**
```json
[
  {
    "date": "2026-01-15",
    "patient_name": "Ana Paula Ferreira",
    "password": "AB123456",
    "proc_code": "30721033",
    "proc_name": "Consulta em consultório (no horário normal ou preestabelecido)",
    "status": "Devidamente Pago",
    "via_acesso": "Sim",
    "act_type": "Eletivo",
    "charged_val": 150.50,
    "paid_val": 130.00
  },
  {
    "date": "2026-01-18",
    "patient_name": "Carlos Eduardo Lima",
    "password": "CD654321",
    "proc_code": "30715040",
    "proc_name": "Visita hospitalar",
    "status": "Glosado",
    "via_acesso": null,
    "act_type": "Eletivo",
    "charged_val": 80.00,
    "paid_val": 0.00
  }
]
```

**Campos:**

| Campo | Tipo | Descrição |
|---|---|---|
| `date` | string (YYYY-MM-DD) | Data do atendimento |
| `patient_name` | string | Nome do paciente |
| `password` | string \| null | Senha da guia/autorização — identificador único do procedimento no atendimento |
| `proc_code` | string | Código TUSS do procedimento |
| `proc_name` | string | Descrição do procedimento |
| `status` | string | Situação do item (ver tabela abaixo) |
| `via_acesso` | string \| null | `"Sim"` se é via de acesso (agrupa procedimentos do mesmo paciente/atendimento) |
| `act_type` | string \| null | Tipo de ato (ex: `"Eletivo"`, `"Urgência"`) |
| `charged_val` | number | Valor cobrado (R$) |
| `paid_val` | number | Valor pago pela operadora (R$) |

**Valores possíveis de `status`:**

| Valor | Significado |
|---|---|
| `"Devidamente Pago"` | Item pago integralmente |
| `"Glosado"` | Item não pago pela operadora |
| `"Recurso"` | Item em processo de recurso de glosa |
| `"Aguardando Fechamento"` | Item ainda não conferido |

**Nota sobre `via_acesso`:** quando `via_acesso = "Sim"`, múltiplos itens do mesmo paciente e atendimento formam uma única "guia" (Via de Acesso). Leve isso em conta nas regras de contagem do financeiro.

---

## Fluxo de uso típico

```
1. GET /api/fin-clientes
   → escolher o médico desejado, guardar o id

2. GET /api/fin-producoes?clienteId={id}
   → escolher a produção, guardar o id

3. GET /api/fin-itens?producaoId={id}
   → receber os itens e aplicar as regras de contagem
```

---

## Códigos de erro

| Status | Significado |
|---|---|
| `400` | Parâmetro obrigatório ausente (ex: `clienteId` não informado) |
| `401` | API Key inválida ou ausente |
| `500` | Erro interno — verifique se as variáveis de ambiente estão configuradas |

**Corpo de erro:**
```json
{ "error": "Descrição do erro" }
```

---

## Exemplo de uso em Node.js

```js
const BASE = 'https://<dominio-vercel>'
const KEY  = process.env.API_KEY_FINANCEIRO

const headers = { 'x-api-key': KEY }

// 1. Buscar médicos
const clientes = await fetch(`${BASE}/api/fin-clientes`, { headers })
  .then(r => r.json())

// 2. Buscar produções do primeiro médico
const producoes = await fetch(`${BASE}/api/fin-producoes?clienteId=${clientes[0].id}`, { headers })
  .then(r => r.json())

// 3. Buscar itens da primeira produção
const itens = await fetch(`${BASE}/api/fin-itens?producaoId=${producoes[0].id}`, { headers })
  .then(r => r.json())

console.log(`${itens.length} procedimentos encontrados`)
```

---

## Configuração necessária no Vercel (responsável pelo sistema web)

Adicionar no painel Vercel → Settings → Environment Variables:

| Variável | Valor |
|---|---|
| `API_KEY_FINANCEIRO` | Chave secreta gerada (ex: `fin-2026-xK9mQzAbCd`) — compartilhar apenas com o sistema financeiro |

> As demais variáveis de ambiente (`VITE_SUPABASE_URL`, `VITE_SUPABASE_SERVICE_KEY`) já estão configuradas e são reutilizadas pelos endpoints.
