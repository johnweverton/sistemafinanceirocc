# Tutorial — Agente de faturamento ISS Fortaleza

> Para quem opera o sistema no dia a dia (Parte 1) e para quem mantém a configuração (Parte 2).
> **Desde 29/09/2026 a busca roda na nuvem (Vercel)** — não precisa mais de computador do
> escritório ligado nem de tarefa agendada. Detalhes técnicos: [`apps/agente-iss/README.md`](../apps/agente-iss/README.md).

## O que o agente faz

Os clientes contábeis cobrados por **faixa de faturamento** pagam R$ 250,00 (faturamento abaixo de
R$ 5.000,00) ou R$ 480,56 (a partir de R$ 5.000,00). Para saber a faixa, alguém precisava abrir o
portal do ISS Fortaleza e copiar o faturamento de cada empresa, uma por uma.

O agente faz essa leitura sozinho e entrega os valores ao sistema como **sugestão**. Ele:

- **só lê** o portal. Nunca escritura, reabre, emite nem exporta nada;
- **não lança nada**. Quem confirma o valor é você, no cálculo em lote;
- **nunca apaga** o que você digitou. Se o valor lançado for diferente do ISS, ele só avisa.

---

## Parte 1 — Uso no dia a dia (operador)

### 1. Abrir o cálculo em lote

1. No menu lateral, clique em **Clientes Contábeis**.
2. Marque os clientes e clique em **Calcular em lote (N)**.
3. Escolha a **competência** (o mês do faturamento, normalmente o mês anterior).

### 2. Pedir a busca no ISS

No topo do passo 1, clique em **Buscar no ISS**.

- A busca lê **só os clientes deste lote** (os que você marcou), nunca a carteira inteira.
- Aparece a mensagem *"Busca no ISS pedida — começando agora."* e o painel mostra
  *"Buscando no ISS… 3/8"*, com uma barra de progresso.
- **Você pode continuar trabalhando.** A busca anda em lotes de ~8 empresas (cerca de 20 s por
  empresa); ao fim de cada lote os campos se preenchem sozinhos. Os campos em que você já digitou
  algo **não são alterados**.
- **Deixe a tela aberta** até terminar: se o lote seguinte demorar a começar, é a própria tela que o
  retoma.
- Mudou de ideia? Clique em **Cancelar busca**.

Quando termina, aparece *"Busca no ISS concluída às HH:MM."*

### 3. Entender o selo de cada cliente

Embaixo de cada campo aparece um de três selos. Passe o mouse sobre o selo para ver o detalhe técnico
(situação no portal, data da leitura).

| Selo | O que significa | O que fazer |
|---|---|---|
| 🟢 **Veio do ISS** | O valor foi lido do portal e já está no campo | Nada. Pode seguir |
| 🟡 **Confira** | Há um valor, mas algo pede atenção. A frase ao lado diz o quê | Ler o motivo e decidir (ver abaixo) |
| ⚪ **Digite à mão** | O agente não trouxe valor para esta empresa | Buscar o valor no portal e digitar, ou usar **Tentar de novo** |

**Motivos do "Confira":**

- *"competência ainda aberta no ISS — o valor pode mudar"*: a empresa ainda não fechou o mês no
  portal. O valor já está no campo, mas pode mudar até o fechamento. Se estiver perto da faixa de
  R$ 5.000,00, vale esperar ou conferir de novo depois.
- *"lançado R$ X difere do ISS R$ Y"*: já existe um faturamento lançado para este mês e ele é
  diferente do ISS. O campo **não** é trocado. Confira qual está certo e, se for o caso, corrija.
- *"possível nota fora da escrituração (ISS R$ X) — confira antes de digitar"*: o ISS trouxe um valor
  estranho em relação ao histórico da empresa (ex.: zero depois de meses com faturamento). O campo fica
  vazio de propósito. Olhe no portal antes de digitar.

**Motivos do "Digite à mão":**

- *"empresa não encontrada no portal do ISS"*: o CNPJ não está na lista do nosso acesso no portal
  (outro município ou sem vínculo). Busque o faturamento por outro meio.
- *"sem escrituração nesta competência (não significa faturamento zero)"*: a empresa existe no
  portal, mas não escriturou o mês. **Não digite zero sem confirmar.**
- *"falha na leitura do ISS"*: algo deu errado na leitura (portal lento, comunicado pendente etc.).
  Clique em **Tentar de novo** ao lado do nome. O agente busca só essa empresa.

### 4. Lançar

Confira os valores e clique em **Lançar faturamentos e continuar**. A partir daí o fluxo é o de
sempre (cálculo da faixa e emissão dos boletos).

### 5. Quando algo não anda

| Você vê | Causa provável | O que fazer |
|---|---|---|
| *"A busca no ISS parece parada — não anda há mais de 3 minutos."* | Um lote caiu no meio (portal lento, instabilidade da Vercel) | Deixar a tela aberta por mais alguns minutos: ela retoma sozinha. Se continuar, cancelar e pedir de novo |
| *"A busca no ISS falhou às HH:MM: …"* | A mensagem diz o motivo (ex.: senha do ISS recusada, portal fora do ar) | Senha recusada: avisar o responsável. **Não tente de novo várias vezes** (o portal pode bloquear o usuário). Portal fora: tentar mais tarde |
| *"Não foi possível verificar as buscas no ISS pelo sistema"* | O sistema não conseguiu consultar as buscas | Digitar os valores normalmente e avisar o responsável |
| O botão **Buscar no ISS** está desativado | Já existe uma busca em andamento para essa competência | Aguardar terminar ou cancelar a busca atual |

---

## Parte 2 — Configuração (responsável técnico)

A busca roda **na Vercel, região São Paulo** (`apps/web/src/server/iss-nuvem`), reaproveitando o
mesmo código de leitura do portal do agente (`apps/agente-iss/src/portal` e `ler-empresa.ts`).

### O que precisa estar configurado

- Na Vercel (Production e Preview): `ISS_CPF` e `ISS_SENHA` (perfil MASTER), `AGENTE_ISS_TOKEN` e
  `AGENTE_ISS_TOKEN_SHA256`. Com `ISS_CPF`/`ISS_SENHA` presentes, a busca pela nuvem fica ligada e
  o agente local deixa de receber pedidos (`/solicitacoes/proxima` responde 204).
- Migration `0062_iss_solicitacoes.sql` aplicada no Supabase.

### Como a busca funciona

- Cada lote dura até ~2,5 min: reivindica o pedido, faz **um login**, troca a inscrição empresa a
  empresa, grava as capturas e libera o pedido para o próximo lote, que é disparado na hora.
- Um lote que cai no meio para de dar sinal de vida; depois de 90 s o próximo o retoma (a tela
  aberta também dispara o lote seguinte a cada consulta de 5 s).
- Senha recusada encerra a busca como *falhou* na hora, **sem nova tentativa**, para não bloquear o
  usuário MASTER. Corrija `ISS_SENHA` na Vercel e peça de novo.
- Os logs ficam na Vercel com o prefixo `[iss-nuvem]` (`vercel logs … | grep iss-nuvem`).

### Agente local (opcional, legado)

O agente de linha de comando continua funcionando para uso manual (`npm run iss:faturamento`,
`--offline`, `--reconhecer`) e para diagnosticar mudanças de layout do portal — ver o
[README do agente](../apps/agente-iss/README.md). A tarefa agendada e o modo `--vigiar` não são mais
necessários.
