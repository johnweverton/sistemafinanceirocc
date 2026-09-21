# Guia do Sistema — Cobrança de Guias Médicas (Carmem Cavalcante)

**Atualizado em:** 2026-07-06 (pós-Épico 5) · **Público:** operadores e administradores do sistema

---

## 1. O que o sistema faz

O sistema automatiza o ciclo completo de **cobrança dos honorários de conferência de guias
médicas**: importa a produção de cada médico, **conta as guias** segundo as regras do negócio,
**calcula o valor** a cobrar pela tabela de preços interna, **emite boletos** registrados (banco
Cora), **dá baixa automaticamente** quando o boleto é pago e mostra tudo em **contas a receber e
dashboard**.

Em uma frase: *da produção do médico ao dinheiro na conta, com conferência no meio*.

```
 Sistema Web (Carmem) ──▶ Sincronizar médicos ──▶ Completar cadastros
        │                                                │
        ▼                                                ▼
 Produções/itens ──▶ EXECUÇÃO (conta guias + calcula) ──▶ Conferência
                                                          │
                                                          ▼
 Dashboard ◀── Contas a Receber ◀── Baixa (webhook) ◀── Boleto Cora
```

---

## 2. As telas e o que fazer em cada uma

| Tela | Caminho | Para quê |
|------|---------|----------|
| Login | `/login` | Acesso com e-mail/senha (Supabase Auth) |
| Médicos | `/medicos` | Cadastro, importação CSV, **sincronização com o sistema web**, pendências |
| Histórico do médico | `/medicos/{id}/historico` | Auditoria: toda alteração fica registrada com autor e motivo |
| Nova execução | `/execucoes/nova` | Disparar o processamento de uma competência |
| Execuções | `/execucoes` | Histórico das execuções com progresso e totais |
| Resultado da execução | `/execucoes/{id}` | Conferência por médico: guias, valores e alertas |
| Contas a Receber | `/recebiveis` | Boletos com status derivado (pago/vencido/em aberto/cancelado) |
| Dashboard | `/dashboard` | KPIs financeiros por competência e por médico + aging de vencidos |
| Configurações | `/configuracoes` | Condições de cobrança padrão (vencimento, multa, juros, desconto) |

### 2.1 Médicos — a fonte de verdade do faturamento

Cada médico carrega os **parâmetros que definem quanto ele paga**:

- **Status Hapvida** (credenciado / não credenciado / nenhum) + **faz outros hospitais** →
  juntos derivam o **TIPO (1–5)** do médico, que define as classes de preço aplicadas.
- **Faz imobilizações** → adiciona a classe de imobilizações.
- **Especialidade** → pediatras têm regra de contagem própria (ver §3).
- **Modo mudança de data** (sim/não) → trava de conferência, não muda o cálculo.
- **Dados de cobrança do pagador** (PF ou PJ, CPF/CNPJ, e-mail, endereço com busca por CEP) →
  obrigatórios para emitir boleto; sem eles a emissão é bloqueada.
- **Condições comerciais** (vencimento, multa, juros, desconto) → opcionais por médico;
  o que ficar em branco herda o padrão de Configurações.

**Três formas de cadastrar:**
1. **Manual** — botão de novo médico.
2. **CSV** — baixar o modelo na tela, preencher e importar (aceita colunas de cobrança).
3. **Sincronizar com sistema web** — puxa os médicos direto da origem (ver §4).

**Pendências:** o filtro/badge "incompleto" mostra exatamente o que falta em cada médico
(CPF, especialidade, dados de cobrança, vínculo com a origem). Médico com cadastro pendente
(**"Aguarda config"**) fica **fora das execuções** até um operador confirmar os parâmetros —
proteção para nunca faturar com dados chutados.

### 2.2 Execução — o coração do sistema

1. Em **Nova execução**, informe a **competência** (mês/ano, ex.: `2026-01`).
2. O sistema lista os médicos aptos (ativos, configurados e vinculados) e busca as **produções**
   de cada um na API do sistema web. Quando o nome da produção casa com a competência
   ("Janeiro 2026" ↔ 2026-01), ela já vem **pré-selecionada — mas a escolha final é sempre sua**
   (dropdown editável). Médico sem produção selecionada fica de fora (aparece como "sem dados").
3. Médicos **não aptos** aparecem em seção separada com o motivo (completar cadastro / vincular).
4. Ao iniciar, o sistema processa **em lotes de 20** (acompanhe o progresso na lista de
   execuções): para cada médico, busca os itens da produção, conta as guias, aplica a tabela de
   preços e grava o resultado. **Falha em um médico não derruba a execução** — vira alerta.

### 2.3 Conferência do resultado

Cada médico termina com um status:

- **OK** — contagem e valores sem ressalvas.
- **Alerta** — precisa de olho humano. Motivos possíveis:
  - *Modo inconsistente* — o padrão de datas observado não bate com o cadastro do pediatra;
  - *Dados incompletos* — itens sem código/descrição na origem;
  - *Variação alta* — guias variaram mais de 40% vs. o mês anterior;
  - *Falha ao buscar dados* — problema de rede com a origem (basta reprocessar).
- **Sem dados** — médico sem produção na competência.

A tela mostra procedimentos, cirurgias, guias, **guias consolidadas** (contagem informativa
agrupando por paciente), subtotais por classe e o valor total.

### 2.4 Boletos, baixa e contas a receber

- **Emissão:** boleto **registrado no Cora** (com multa/juros/desconto conforme configuração e
  vencimento calculado). Hoje a emissão existe como API (`POST /api/boletos/emitir`) e está
  **desligada pela chave de segurança `GATEWAY_EMISSAO_HABILITADA`** — só será ligada quando
  o certificado mTLS do Cora estiver validado em produção. Proteções automáticas: só emite
  sobre resultado **OK**, com médico vinculado e **cadastro de cobrança completo** (senão
  bloqueia com mensagem clara).
- **Baixa automática:** quando o boleto é pago, o Cora avisa o sistema (webhook). Por segurança,
  o sistema **não confia no aviso**: reconsulta a API do Cora e só então marca como pago.
  Avisos repetidos são ignorados (idempotência) e tudo fica auditado.
- **Contas a Receber:** cada boleto aparece com status **derivado na hora**: `pago`,
  `cancelado`, `vencido` (venceu e não pagou) ou `em aberto`. Filtros por competência, médico
  e status.

### 2.5 Dashboard

- **Por competência:** total emitido, recebido, em aberto, vencido e **taxa de inadimplência**.
- **Por médico:** os mesmos números + ticket médio.
- **Aging de vencidos:** faixas 0–30 / 31–60 / 60+ dias de atraso.

---

## 3. As regras de contagem e preço (o "motor")

### Contagem de guias (a partir dos itens da produção)

1. **Todos os itens contam**, independente do status na origem (Devidamente Pago, **Glosado**,
   **Recurso**, Aguardando Fechamento) — porque a cobrança é pela **conferência da guia**, não
   pelo pagamento da operadora.
2. Linhas **sem paciente ou sem data** são descartadas e **reportadas como alerta** no resultado
   do médico (nunca somem em silêncio).
3. A regra de contagem **depende da especialidade cadastrada no médico**. Existem dois mundos:

**a) Especialidades com "regra 3x1" — pediatra, urologista, ginecologista, ortopedista e
angiologista.** Os procedimentos são agrupados por **atendimento + data** e **cada grupo de até
3 procedimentos vale 1 guia** (`teto(n/3)`): 1, 2 ou 3 procedimentos do mesmo atendimento = 1
guia; 4 a 6 = 2 guias; e assim por diante.

- Itens marcados como **via de acesso** (`via_acesso = "Sim"`) seguem a **mesma regra 3x1**, num
  balde próprio — **não** são sempre "uma única guia". (Isso mudou por um achado real: a origem
  costuma dar uma senha diferente para cada procedimento da mesma cirurgia, o que fragmentava o
  atendimento e ignorava o 3x1.)
- **Exceções por especialidade:** alguns procedimentos **saem do bolo do 3x1** e valem **1 guia
  cheia cada um**, porque são procedimentos completos por si só — nem diluem, nem são diluídos
  pelos demais:
  - **Urologista:** uma lista fechada de **códigos** (cateterismo ureteral, dissecção de veia
    para cateter central, intra-operatório, vasectomia unilateral, cateterismo de artéria radial
    e radioscopia para acompanhamento cirúrgico).
  - **Ginecologista:** identificado pela **descrição** do procedimento — qualquer variação de
    **DIU** (inserção, retirada, hormonal, não hormonal) e de **histeroscopia**. Usa descrição
    em vez de código porque a origem tem vários códigos diferentes para a mesma coisa.
    *Histerectomia não é exceção* — entra no bolo normal.
  - **Angiologista:** o código de **intra-operatório**, dentro do lote de Angiografia.
  - **Pediatra e ortopedista não têm exceção nenhuma** — todo procedimento entra no bolo.

**b) Todas as outras especialidades.** Sem agrupamento: **1 item = 1 guia**. Os itens de via de
acesso do mesmo atendimento, aí sim, contam como **uma única guia**.

> **Especialidade em branco no cadastro conta como "outras especialidades"** — ou seja, perde o
> 3x1 e as exceções. Por isso o sistema emite alerta quando processa produção de um médico sem
> especialidade cadastrada.

> **Importante:** enquanto a origem não enviar um identificador de atendimento confiável, o
> agrupamento cai para paciente+data — o que **subconta** guias no caso raro de um mesmo paciente
> ter duas cirurgias separadas no mesmo dia. Ver §6 (pendências).

> **Angiologista é um caso à parte:** não tem lote principal. A produção vem de 4 fontes
> separadas — Cateter (1 item = 1 guia), Fístula (1 item = 1 guia), Angiografia (regra 3x1 com a
> exceção acima) e Carta de Rede (quantidade **informada manualmente** pelo operador, porque não
> existe regra fixa). As 4 se somam numa faixa única da tabela de preço do médico.

### Preço

O valor **nunca vem da origem** (`charged_val`/`paid_val` são só informativos). O sistema aplica
a **tabela de preços interna** (tabela `precos` no banco, editável sem deploy) por **classe**:

| Classe | Quando se aplica |
|--------|------------------|
| HAPVIDA_CRED | Médico credenciado Hapvida |
| HAPVIDA_NAO_CRED | Médico não credenciado Hapvida |
| OUTROS_HOSPITAIS | Médico que atende outros hospitais |
| IMOBILIZACOES | Médico que faz imobilizações |

Cada classe tem faixas por quantidade de guias; quantidade fora da tabela vira **alerta**
(nunca chuta valor).

---

## 4. Integração com o Sistema Web (origem dos dados)

O sistema consome a API do Sistema Web da Carmem (read-only, autenticada por chave):

| Endpoint | O que traz |
|----------|-----------|
| `fin-clientes` | Médicos da origem (nome + tipo de produção) |
| `fin-producoes` | Produções nomeadas de cada médico (ex.: "Janeiro 2026") |
| `fin-itens` | Itens de uma produção (data, paciente, procedimento, status, via de acesso) |

**Sincronizar médicos** (botão na tela de Médicos) classifica cada médico da origem:

- **Já vinculado** → atualiza nome/status Hapvida se mudou (com histórico).
- **Com sugestão** → o sistema encontrou um cadastro local com nome parecido e **você confirma**
  o par (o vínculo é permanente — nada é vinculado sem confirmação humana).
- **Sem par** → você manda **criar** o médico novo (nasce incompleto e vai para as pendências).
- "Produção Credenciada" → credenciado; "Produção VH" → não credenciado (automático).

A origem **não envia CPF** — por isso o vínculo usa um identificador interno permanente e o CPF
fica como pendência de cadastro a completar manualmente.

---

## 5. Perfis, segurança e auditoria

| Perfil | Pode |
|--------|------|
| **admin** | Tudo: médicos, sincronização, execuções, configurações |
| **colaborador** | Consultar e disparar execuções |
| **financeiro** | Consultar execuções, recebíveis e dashboard |

- Usuário novo **não entra sozinho**: precisa ter perfil criado por um admin (há uma allowlist
  de e-mails de bootstrap para o primeiro acesso).
- **Toda alteração de médico exige motivo** e fica no histórico (quem, quando, o quê, por quê).
- Chaves e segredos (API do sistema web, Cora, Supabase) vivem **só no servidor** —
  nunca no navegador, nunca no repositório.
- Webhook do Cora: segredo na URL + reconsulta na API antes de dar baixa (não confia no aviso).
- Banco (Supabase/Postgres) com RLS: escrita só pelo servidor; leitura conforme o perfil.

---

## 6. Rotina mensal sugerida (passo a passo)

1. **Sincronizar** — Médicos → "Sincronizar com sistema web". Confirmar pares sugeridos e criar
   os médicos novos.
2. **Completar pendências** — filtro "incompleto": preencher CPF, especialidade e dados de
   cobrança (o CEP preenche o endereço sozinho). Ao salvar, o médico sai de "Aguarda config".
3. **Executar** — Nova execução → competência → conferir/ajustar as produções pré-selecionadas →
   iniciar. Acompanhar o progresso.
4. **Conferir** — abrir o resultado, tratar os **alertas** um a um (é para isso que eles
   existem), reprocessar se houve falha de rede.
5. **Cobrar** — *(quando a emissão for ligada)* emitir os boletos dos resultados OK.
6. **Acompanhar** — Contas a Receber para o dia a dia; Dashboard para a visão do mês
   (inadimplência e aging).

---

## 7. Configuração técnica (para o administrador)

**Variáveis de ambiente** (em `apps/web/.env.local` no dev; painel do Vercel em produção):

| Variável | Para quê |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Conexão com o Supabase (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Escrita server-side (nunca expor) |
| `BOOTSTRAP_ADMIN_EMAILS` | E-mails autorizados ao primeiro acesso como admin |
| `API_FINANCEIRO_URL` / `API_FINANCEIRO_KEY` | API do Sistema Web (origem) |
| `FIN_API_SOURCE` | `http` (API real) ou `local` (fixtures de teste) |
| `INTERNAL_SECRET` / `APP_BASE_URL` | Encadeamento interno dos lotes de execução |
| `GATEWAY_EMISSAO_HABILITADA` | Liga/desliga a emissão de boletos (hoje `false`) |
| `BOLETO_GATEWAY` | `cora` (real) ou `mock` (teste) |
| `CORA_API_URL` / `CORA_CLIENT_ID` / `CORA_CERT_BASE64` / `CORA_KEY_BASE64` | Credenciais mTLS do Cora |
| `CORA_WEBHOOK_SECRET` | Segredo do webhook de baixa |

**Banco:** migrations `0001`–`0011` em `supabase/migrations/` (aplicadas manualmente no SQL
Editor do Supabase; a `0011` — vínculo com a origem e seleções de execução — já está aplicada).

**Stack:** Next.js (App Router) + Supabase (Postgres/Auth/RLS) na Vercel. Monorepo com
`packages/shared` (tipos e regras compartilhadas) e motor de cálculo **puro** (testado com casos
de ouro do PRD §12 e do contrato real — 165 testes automatizados).

---

## 8. Estado atual e pendências (2026-07-06)

| Item | Estado |
|------|--------|
| Cadastro/CSV/sincronização de médicos | ✅ Em produção (código no ar) |
| Execução por produção (API real) | ✅ Pronto — **aguardar 1 pendência antes do 1º uso real** |
| Emissão de boletos Cora | 🔒 Pronta, **desligada por flag** (gate: certificado mTLS em produção) |
| Baixa por webhook + Recebíveis + Dashboard | ✅ Prontos (exercitados de verdade quando a emissão ligar) |
| Migration 0011 | ✅ Aplicada |

**Pendências externas (com o programador do sistema web):**
1. **Campo do atendimento no `fin-itens`** (senha ou nº) — *pendência que importa*: sem ele, o
   sistema subconta guias quando o mesmo paciente tem 2 atendimentos no mesmo dia. O código já
   aceita o campo automaticamente quando chegar. **Não rodar execução oficial antes disso.**
2. **CPF no `fin-clientes`** — melhoria do pareamento na sincronização (não bloqueia).

**Documentos de referência:**
- Contrato da API externa: `docs/integracao/api-financeiro-sistema-web.md`
- Arquitetura da integração: `docs/architecture/feature-integracao-api-financeiro.md`
- Ciclo financeiro (boletos/baixa/dashboard): `docs/architecture/feature-ciclo-financeiro.md`
- Épicos e stories: `docs/stories/README.md`

---

## 9. Glossário rápido

| Termo | Significado |
|-------|-------------|
| **Competência** | O mês de produção sendo cobrado (ex.: 2026-01) |
| **Guia** | Unidade de cobrança da conferência — o que o sistema conta |
| **Via de acesso** | Marcação da origem que agrupa procedimentos da mesma cirurgia em 1 guia |
| **Produção** | O "pacote" mensal de itens de um médico no sistema web (ex.: "Janeiro 2026") |
| **Execução** | Um processamento completo de uma competência para os médicos selecionados |
| **Consolidado** | Contagem informativa agrupando por paciente (comparativo de conferência) |
| **Baixa** | Registro de que o boleto foi pago (automático via Cora) |
| **Aging** | Classificação dos vencidos por tempo de atraso |
| **TIPO (1–5)** | Classificação do médico derivada de Hapvida + outros hospitais |
