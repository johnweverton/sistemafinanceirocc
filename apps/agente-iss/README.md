# Agente de faturamento ISS Fortaleza

Lê, no portal ISS Fortaleza, o **Somatório de Serviços Prestados → Valor do Serviço** da escrituração de
cada cliente contábil em modo *faixa de faturamento* e envia os valores ao Sistema Financeiro como
**proposta** para conferência. Não lança nada direto: quem confirma é o operador, no diálogo de lote.

Arquitetura: [`docs/architecture/feature-agente-faturamento-iss.md`](../../docs/architecture/feature-agente-faturamento-iss.md) ·
Story: [`docs/stories/13.2.agente-iss-cli.story.md`](../../docs/stories/13.2.agente-iss-cli.story.md)

## Para o operador

### Jeito recomendado: botão "Buscar no ISS" no sistema (Story 13.5)

**Uma vez só, no computador do escritório** (alguém do sistema faz isso):

1. rode `npm run iss:configurar` (CPF e senha do ISS, token do agente e endereço do sistema — ver
   *Primeira vez neste computador* abaixo);
2. dê um duplo clique em `scripts\agente-iss\instalar-tarefa-agendada.cmd`. Ele cria no Agendador de
   Tarefas do Windows a tarefa **"Agente ISS - pedidos do sistema"**, que a cada minuto roda o agente
   com `--uma-vez`: pergunta ao sistema se alguém pediu uma busca e, se sim, faz a leitura; se não,
   termina na hora. O instalador compila o agente uma vez e grava o roteiro da tarefa em
   `%USERPROFILE%\agente-iss\tarefa-agendada.cmd` (fora do OneDrive; nada é recompilado a cada minuto).
   - **Atualizou o sistema (`git pull`)? Rode o instalador de novo**, para recompilar o agente.
   - Do jeito padrão a tarefa só roda com alguém logado no Windows, e uma janela preta pode piscar por
     alguns segundos a cada minuto. Para não ter janela nenhuma (e rodar mesmo sem ninguém logado),
     use `instalar-tarefa-agendada.cmd /oculta` — o Windows pede a senha **do Windows** dessa conta.
   - Para desinstalar: `instalar-tarefa-agendada.cmd /remover`.
   - Sem tarefa agendada, dá para deixar uma janela aberta com `npm run iss:faturamento -- --vigiar`
     (consulta a cada 60 s até a janela ser fechada).

**Depois disso, no dia a dia** (qualquer pessoa, de qualquer computador):

1. abra *Clientes Contábeis › Calcular em lote* e escolha o mês;
2. clique em **Buscar no ISS**. A linha ao lado mostra "Na fila…" e, quando o computador do escritório
   pega o pedido (em até 1 minuto), "Buscando no ISS… 34/90";
3. os campos que você **não** mexeu vão se preenchendo sozinhos conforme a busca avança — o que você
   já digitou nunca é trocado;
4. se uma empresa ficar em **Digite à mão** por "não encontrada" ou "falha na leitura", o link
   **Tentar de novo** ao lado busca só ela.

Enquanto uma busca está em andamento o botão fica desabilitado (só existe uma por mês de cada vez) e
aparece **Cancelar busca**. Se a tela avisar que **o computador do escritório parece desligado**, é
porque o pedido está parado há mais de 3 minutos: confira se o computador está ligado e com a tarefa
instalada. O que o agente fez fica registrado em `%USERPROFILE%\agente-iss\vigiar.log`.

A senha do ISS continua **só** no `.env` do computador do escritório: o botão não a envia, e nenhuma
parte do sistema na internet a conhece.

### Jeito manual: atalho na Área de Trabalho

**O que o atalho faz.** Dê um duplo clique em **Buscar faturamento ISS** (o arquivo
`scripts\agente-iss\Buscar faturamento ISS.cmd`; para tê-lo na Área de Trabalho, clique com o botão
direito › *Enviar para* › *Área de trabalho (criar atalho)* — ou copie o arquivo depois de rodá-lo uma
vez de dentro da pasta do sistema). Uma janela preta abre e:

1. pergunta **qual mês** buscar — aperte Enter para o mês anterior (o normal), ou digite, por exemplo, `08/2026`;
2. diz quantas empresas vai ler e quanto tempo leva, e pergunta se pode começar — Enter = sim;
3. entra no portal do ISS sozinho e lê o faturamento de cada empresa (não mexa no navegador se ele aparecer);
4. no fim, manda os valores para o sistema e oferece **abrir a tela de cálculo em lote** já no mês
   certo, com os clientes marcados. Se algo falhar no envio, não precisa fazer nada: da próxima vez
   que o atalho rodar, ele reenvia sozinho (sem duplicar: cada execução leva uma chave, e o sistema
   devolve a já gravada). Se o sistema **recusar** o resultado (ex.: um cliente saiu da faixa, ou a
   busca foi cancelada), ele não é reenviado: a pasta da execução ganha o arquivo `envio-recusado`
   com o motivo.

A janela só fecha quando você apertar uma tecla, para dar tempo de ler o resultado.

**O que o selo embaixo de cada valor quer dizer** (na tela *Clientes Contábeis › Calcular em lote*):

| Selo | O que significa | O que fazer |
|---|---|---|
| **Veio do ISS** (verde) | O valor foi lido do ISS e está pronto | Nada — pode seguir |
| **Confira** (amarelo) | Há um valor, mas algo pede atenção (a frase ao lado diz o quê: mês ainda aberto no ISS, possível nota fora da escrituração, ou valor diferente do já lançado) | Confira no ISS antes de lançar |
| **Digite à mão** (cinza) | O agente não conseguiu o valor (empresa não encontrada, sem escrituração no mês ou falha na leitura) | Digite o faturamento como antes |

Passe o mouse sobre o selo para ver o detalhe técnico (útil se precisar chamar alguém).

**Primeira vez neste computador.** Alguém precisa rodar `npm run iss:configurar` uma vez: ele pergunta
o CPF e a senha do ISS, o token do agente e o endereço do sistema, grava tudo em
`%USERPROFILE%\agente-iss\.env` (fora do OneDrive) e confere se o token está certo.

**Quando chamar o responsável pelo sistema:**

- a janela diz que a **senha** do ISS está errada (o agente para na hora, de propósito, para não bloquear o usuário);
- a janela diz que o **token** não confere ou que o sistema não respondeu;
- aparecem **muitos "Digite à mão" de uma vez** (o portal do ISS pode ter mudado);
- a janela terminou com "Terminou com problema" e as mensagens não fazem sentido.

## Configuração (uma vez, na máquina do escritório)

Crie `%USERPROFILE%\agente-iss\.env` (ex.: `C:\Users\<usuario>\agente-iss\.env`). **Fora do OneDrive**:
o agente recusa rodar se a pasta estiver dentro dele, porque a senha seria sincronizada para a nuvem.

```ini
# Login do perfil MASTER no ISS Fortaleza
ISS_CPF=00000000000
ISS_SENHA=********
# Token do agente (o hash dele vai na Vercel como AGENTE_ISS_TOKEN_SHA256 — ver Story 13.1)
AGENTE_ISS_TOKEN=<64 caracteres hex>
SISTEMA_URL=https://<endereço do Sistema Financeiro>
```

Precisa do Google Chrome instalado (ou do Chromium do Playwright: `npx playwright install chromium`).

## Uso

```bash
npm run iss:faturamento                                   # competência = mês anterior, todos os clientes
npm run iss:faturamento -- --competencia 2026-08
npm run iss:faturamento -- --cnpj 08293377000198 --headed # uma empresa, vendo o navegador
npm run iss:faturamento -- --offline --cnpj 08293377000198 --headed
                                                          # valida a leitura do portal sem falar com o sistema
npm run iss:faturamento -- --reenviar "<pasta>\execucao.json"  # envio falhou? reenvia sem abrir o portal
npm run iss:faturamento -- --vigiar                       # atende os pedidos do botão "Buscar no ISS" (a cada 60 s)
npm run iss:faturamento -- --uma-vez                      # atende no máximo UM pedido e termina (tarefa agendada)
npm run iss:faturamento -- --ajuda
```

### Modo vigiar / agendado (Story 13.5)

`--vigiar` e `--uma-vez` não aceitam `--competencia`, `--cnpj`, `--limite`, `--offline`, `--sem-envio`
nem `--reenviar`: a competência e as empresas vêm do pedido feito no sistema (`--headed` e
`--reconhecer` continuam valendo, para depuração). Por pedido, o agente:

1. reivindica o pedido em `GET /api/integracoes/iss/solicitacoes/proxima` (o sistema o marca
   *em andamento* em nome desta máquina — dois agentes nunca pegam o mesmo);
2. reenvia o que tiver ficado pendente de execuções anteriores;
3. abre o navegador e faz **um login novo** (a sessão do portal não é reaproveitada entre pedidos),
   lendo só as empresas pedidas (pedido de "Tentar de novo" = uma empresa só);
4. manda o progresso a cada empresa (`POST .../progresso` — é também o sinal de vida);
5. envia a execução com o `solicitacaoId` e fecha o pedido (`POST .../concluir`).

Senha recusada, portal fora do ar ou nenhuma empresa para buscar fecham o pedido como **falhou**, com a
mensagem, para a tela não ficar esperando. Se o operador cancelar no meio, o agente para na empresa
seguinte (o parcial fica salvo, sem envio). Se o computador desligar no meio, o pedido é entregue de
novo depois de 10 minutos sem sinal de vida.

Cada execução cria `%USERPROFILE%\agente-iss\execucoes\<data-hora>-<competência>\` com:

- `execucao.json`: o resultado (salvo a cada empresa, então uma queda no meio não perde o que já foi lido);
- `agente.log`: o passo a passo;
- `snapshots/`: HTML e print das telas onde algo deu errado (com `--reconhecer`, de todos os passos).
  O CPF do login é removido do HTML salvo.

## O que cada status significa

| Status | Significado | O que fazer |
|---|---|---|
| capturado | Leu o Somatório. `competência ABERTA` = o valor ainda pode mudar | Conferir no diálogo de lote |
| sem escrituração | A empresa existe no portal, mas não há escrituração na competência | Verificar; **não** significa faturamento zero |
| não encontrado | O CPF/CNPJ não está na lista de inscrições do perfil MASTER | Outro município ou sem vínculo: lançar à mão |
| erro | Tela inesperada, sessão, ou verificação de segurança falhou (ver snapshot) | Rodar de novo só essa empresa com `--cnpj` |

## Garantias de segurança

- **Só leitura.** Os seletores só apontam para Pesquisar, Selecionar, Sim (troca de empresa),
  Consultar e Visualizar. Nunca clica em Escriturar, Reabrir, Exportar nem Emitir.
- **Nunca lê a empresa errada.** Antes de devolver um valor, confere que a "Inscrição Atual" do portal
  é a da empresa pedida e que a visualização aberta é da competência pedida.
- **Senha errada para tudo.** Uma tentativa só, para não bloquear o usuário MASTER.
- **Comunicado oficial ("Dar Ciência").** Ainda não é automático: o fluxo não foi gravado no portal
  real. A empresa sai como *erro*, com a tela salva. Dê a ciência manualmente uma vez e rode de novo.

## Quando o portal mudar

Os seletores ficam todos em `src/portal/seletores.ts` e são testados contra HTML real anonimizado em
`tests/fixtures/`. Se o portal mudar de layout:

1. rode com `--reconhecer --headed --cnpj <um cnpj>` para gravar as telas novas, ou use o gravador
   manual (`node apps/agente-iss/scripts/gravador.cjs`: você navega e ele salva cada tela, sem gravar
   a tela de login);
2. ajuste `seletores.ts`;
3. atualize o fixture e rode `npm test --workspace apps/agente-iss`.
