# Tutorial — Agente de faturamento ISS Fortaleza

> Para quem opera o sistema no dia a dia (Parte 1) e para quem instala e mantém o agente no
> computador do escritório (Parte 2). Detalhes técnicos: [`apps/agente-iss/README.md`](../apps/agente-iss/README.md).

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

- Aparece a mensagem *"Busca no ISS pedida — o computador do escritório começa em até 1 minuto."*
- Em seguida o painel mostra o andamento:
  - *"Na fila — aguardando o computador do escritório começar a busca no ISS…"*
  - *"Buscando no ISS… 34/90"*, com uma barra de progresso.
- **Você pode continuar trabalhando.** Conforme o agente lê cada empresa, o campo de faturamento dela
  se preenche sozinho. Os campos em que você já digitou algo **não são alterados**.
- A carteira inteira leva cerca de **12 a 15 segundos por empresa** (90 empresas ≈ 20 a 25 minutos).
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
| *"O computador do escritório com o agente parece desligado — a busca não anda há mais de 3 minutos."* | O computador do escritório está desligado, sem internet, ou a tarefa agendada não está instalada | Ligar o computador (e deixá-lo com o usuário logado). Se continuar, chamar o responsável (Parte 2) |
| *"A busca no ISS falhou às HH:MM: …"* | A mensagem diz o motivo (ex.: senha do ISS recusada, portal fora do ar) | Senha recusada: avisar o responsável. **Não tente de novo várias vezes** (o portal pode bloquear o usuário). Portal fora: tentar mais tarde |
| *"Não foi possível verificar as buscas no ISS pelo sistema"* | O sistema não conseguiu consultar as buscas | Digitar os valores normalmente e avisar o responsável |
| O botão **Buscar no ISS** está desativado | Já existe uma busca em andamento para essa competência | Aguardar terminar ou cancelar a busca atual |

---

## Parte 2 — Instalação e manutenção (responsável técnico)

O agente roda **no computador do escritório**, porque a senha do portal do ISS fica **só nele** e
nunca vai para a nuvem. O sistema web apenas registra o pedido; o computador do escritório o
atende.

### Pré-requisitos

- Windows, com **Node.js 20+** e **Google Chrome** instalados.
- O sistema baixado nesse computador (`git clone`), com `npm install` rodado na pasta.
- Migration `supabase/migrations/0062_iss_solicitacoes.sql` **aplicada no Supabase** (SQL Editor).
  Aplique-a **antes** de publicar o sistema e de atualizar o agente.
- Na Vercel, a variável `AGENTE_ISS_TOKEN_SHA256` configurada (o hash do token do agente — Story 13.1).

### Passo 1 — Configurar (uma vez)

Na pasta do sistema:

```
npm run iss:configurar
```

O assistente pergunta **CPF e senha do ISS** (perfil MASTER; a senha não aparece enquanto você
digita), o **token do agente** e o **endereço do sistema**. Ele grava tudo em
`%USERPROFILE%\agente-iss\.env`, **fora do OneDrive** (o agente se recusa a usar uma pasta
sincronizada), e confere o token com o sistema.

> A senha **não** é testada no portal nesse momento, para não arriscar o bloqueio do usuário MASTER.

### Passo 2 — Instalar a tarefa agendada (uma vez)

Dê um duplo clique em `scripts\agente-iss\instalar-tarefa-agendada.cmd`.

Ele compila o agente e cria no Agendador de Tarefas do Windows a tarefa
**"Agente ISS - pedidos do sistema"**. A cada minuto ela pergunta ao sistema se alguém clicou em
**Buscar no ISS**: se sim, faz a leitura; se não, termina na hora.

| Opção | Efeito |
|---|---|
| `instalar-tarefa-agendada.cmd` | Padrão: roda com o usuário logado; uma janela preta pode piscar a cada minuto |
| `instalar-tarefa-agendada.cmd /oculta` | Sem janela e mesmo sem ninguém logado. Pede a senha **do Windows** da conta |
| `instalar-tarefa-agendada.cmd /remover` | Remove a tarefa |

Alternativa sem tarefa agendada: deixar uma janela aberta com `npm run iss:faturamento -- --vigiar`.

### Passo 3 — Testar

1. No sistema, abra o cálculo em lote de uma competência já fechada e clique em **Buscar no ISS**.
2. Em até 1 minuto o painel deve passar para *"Buscando no ISS… N/total"*.
3. O que o agente fez fica em `%USERPROFILE%\agente-iss\vigiar.log`.

### Atualizações

Depois de cada `git pull`, **rode o instalador de novo**: é ele que recompila o agente. A tarefa
agendada roda a versão compilada e não recompila sozinha.

### Uso sem o sistema web (atalho manual)

Também dá para rodar o agente pela mão, sem o botão:

- Duplo clique em `scripts\agente-iss\Buscar faturamento ISS.cmd` (pode criar um atalho na Área de
  Trabalho: botão direito › *Enviar para* › *Área de trabalho (criar atalho)*).
- Ele pergunta o mês (Enter = mês anterior), diz quantas empresas vai ler e quanto tempo leva, faz a
  leitura e, no fim, oferece abrir o cálculo em lote já na competência certa.

### Onde ficam os arquivos

Tudo em `%USERPROFILE%\agente-iss\`:

| Arquivo / pasta | O que é |
|---|---|
| `.env` | CPF, senha do ISS, token e endereço do sistema |
| `vigiar.log` | Registro das buscas pedidas pelo sistema |
| `tarefa-agendada.cmd` | Roteiro que a tarefa agendada executa (gerado pelo instalador; não editar) |
| `execucoes\<data-hora>-<competência>\` | Uma pasta por leitura: `execucao.json` (resultado), `agente.log` e `snapshots\` (telas onde algo deu errado, com o CPF removido) |

Marcas dentro da pasta de uma execução:

- `envio-pendente`: o envio ao sistema falhou (rede, sistema fora do ar). **Não precisa fazer nada**:
  a próxima execução reenvia sozinha, sem duplicar.
- `envio-recusado`: o sistema recusou o resultado de vez (ex.: cliente saiu da faixa, busca
  cancelada). Não será reenviado; o motivo está dentro do arquivo.

### Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Painel diz que o agente parece desligado | Conferir se o computador está ligado e logado, e se a tarefa existe no Agendador de Tarefas. Ver `vigiar.log` |
| Busca falhou com senha recusada | Conferir a senha no portal pelo navegador e rodar `npm run iss:configurar` de novo. O agente tenta **uma vez só** por busca, para não bloquear o usuário MASTER |
| Empresa sempre em "falha na leitura" | Pode ser um comunicado pendente no portal ("Dar Ciência"), que o agente ainda não trata sozinho. Entrar no portal com essa empresa, dar a ciência e usar **Tentar de novo** |
| `Sistema respondeu 401` no log | Token errado ou `AGENTE_ISS_TOKEN_SHA256` desatualizado na Vercel. Rodar `npm run iss:configurar` |
| Erro 500 ao enviar logo depois de atualizar | A migration 0062 não foi aplicada. Aplique-a; o resultado ficou salvo e será reenviado sozinho |
| O portal mudou de layout | Ver a seção *Quando o portal mudar* do [README do agente](../apps/agente-iss/README.md) |
