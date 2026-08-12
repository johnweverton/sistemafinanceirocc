# Solicitação de melhoria na API — identificação de sub-lotes (Angiologista)

Documento para o desenvolvedor do **Sistema Web (Carmem Cavalcante)**, que mantém a API descrita em [`api-financeiro-sistema-web.md`](./api-financeiro-sistema-web.md). Aqui pedimos uma melhoria pontual nessa mesma API.

---

## Contexto

Para médicos da especialidade **Angiologista**, o financeiro precisa aplicar **regras de contagem diferentes por tipo de procedimento**, dentro da mesma competência (mês):

| Sub-lote (como aparece no painel de origem) | Regra de contagem |
|---|---|
| Cateter (ex.: "SAMANTA CETETER 1Q") | 1 procedimento = 1 guia |
| Fístula (ex.: "SAMANTA FISTULA 1Q") | 1 procedimento = 1 guia |
| Angiografia (ex.: "SAMANTA PACOTE 25K 1Q") | a cada 3 procedimentos = 1 guia, exceto o código de Intra-operatório, que sempre conta como 1 guia individual |


No painel do sistema de origem, esses 4 tipos aparecem como **sub-lotes nomeados dentro da produção do mês** (ex.: dentro de "JULHO - 2026" existem os sub-lotes acima), cada um com sua própria contagem visível na tela.

## O problema

Consultando a API atual:

- `GET /api/fin-producoes?clienteId=<id>` só retorna a produção do mês inteiro (ex.: `{"id": "...", "name": "JULHO - 2026"}`) — os sub-lotes não aparecem como itens separados.
- `GET /api/fin-itens?producaoId=<id da produção do mês>` retorna todos os itens de todos os sub-lotes juntos, misturados, sem nenhum campo que diga de qual sub-lote cada item veio.

Isso nos impede de aplicar a regra de contagem correta por tipo de lote, hoje não temos como distinguir, olhando a resposta da API, se um item é de Cateter, Fístula, Angiografia ou Carta de Rede.

**Isso é diferente do que já existe hoje para "Outros Hospitais" e "Imobilizações"**, que já funcionam sem mudança nenhuma na API: nesses casos, a coordenadora cadastrou cada um como uma produção própria, **irmã** da produção mensal principal (dois registros no mesmo nível, ex.: "Julho 2026" e "Outros Hospitais - Julho 2026"), então `GET /api/fin-producoes` já retorna as duas separadamente. Já Cateter/Fístula/Angiografia/Carta de Rede foram cadastrados como **sub-grupos aninhados dentro da própria produção do mês** — um recurso de organização visual do painel de origem que não cria produções separadas de verdade, então a API não os enxerga como entidades distintas.

## O que precisamos

Alguma forma de identificar, por item ou por produção, a qual sub-lote cada guia pertence. Duas opções — fica a critério de vocês qual é mais simples de implementar do lado de origem:

### Opção A: sub-lotes como produções próprias

`GET /api/fin-producoes?clienteId=<id>` passaria a retornar cada sub-lote como uma entrada própria, com seu próprio `id`, por exemplo:

```json
[
  { "id": "...", "name": "SAMANTA CETETER 1Q" },
  { "id": "...", "name": "SAMANTA FISTULA 1Q" },
  { "id": "...", "name": "SAMANTA PACOTE 25K 1Q" },
  { "id": "...", "name": "SAMANTA CARTA DE REDE" }
]
```

Cada um consultável normalmente via `GET /api/fin-itens?producaoId=<id>`, retornando só os itens daquele sub-lote.

Essa opção é a que preferimos, porque já temos no nosso sistema o mesmo padrão de seleção de lote separado usado hoje para "Outros Hospitais" e "Imobilizações" — reaproveitaríamos a mesma tela sem retrabalho.

### Opção B: campo de lote no item

`GET /api/fin-itens?producaoId=<id da produção do mês>` continuaria retornando tudo junto, mas cada item ganharia um campo novo identificando o sub-lote de origem, por exemplo:

```json
{
  "date": "2026-07-15",
  "patient_name": "Ana Paula Ferreira",
  "password": "AB123456",
  "proc_code": "31303293",
  "proc_name": "Angiografia por cateterismo seletivo...",
  "batch_name": "SAMANTA PACOTE 25K 1Q",
  "status": "Devidamente Pago",
  ...
}
```

Pode ser mais simples de implementar dependendo de como o dado já está armazenado internamente.

Qualquer dúvida sobre o motivo do pedido ou sobre o formato de resposta, estamos à disposição para alinhar antes da implementação.
