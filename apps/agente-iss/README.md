# Agente de faturamento ISS Fortaleza

Lê, no portal ISS Fortaleza, o **Somatório de Serviços Prestados → Valor do Serviço** da escrituração de
cada cliente contábil em modo *faixa de faturamento* e envia os valores ao Sistema Financeiro como
**proposta** para conferência. Não lança nada direto: quem confirma é o operador, no diálogo de lote.

Arquitetura: [`docs/architecture/feature-agente-faturamento-iss.md`](../../docs/architecture/feature-agente-faturamento-iss.md) ·
Story: [`docs/stories/13.2.agente-iss-cli.story.md`](../../docs/stories/13.2.agente-iss-cli.story.md)

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
npm run iss:faturamento -- --ajuda
```

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
