# Recomendações — features candidatas (ranqueadas por valor ÷ esforço)

> Documento de pesquisa — SEM código de produção. Implementação via @pm (priorização/épico) →
> @architect (design) → SDC normal.

## Matriz de decisão

| # | Feature | Valor | Esforço | Dependência externa | Recomendação |
|---|---------|-------|---------|--------------------:|--------------|
| 0 | **Fix webhook: ler headers da notificação** | Alto (corrige bug real) | XS | — | **Imediato (hotfix)** |
| 1 | **Conciliação bancária + extrato** (página "Extrato/Caixa") | Alto | M | — | Épico próprio (era o interesse original; já está em discovery com a coordenação) |
| 2 | **Pix copia-e-cola nas mensagens** de cobrança | Alto (recebe mais rápido) | S | Chave Pix cadastrada nas contas | Fazer junto do épico 1 ou avulso |
| 3 | **NFS-e automática ao pagar** | Alto (elimina trabalho manual da contabilidade) | M/L | Certificado A1 e-CNPJ por empresa + credenciais da prefeitura + R$ 0,49/nota | Validar com o dono se a Carmem emite NFS-e hoje e onde |
| 4 | **Saldo MC/CV no dashboard** | Médio | S | CV precisa de credenciais (Cora Pro) | Carona no épico 1 |
| 5 | **Régua de atraso via `invoice.overdue`** (lembrete WhatsApp/e-mail) | Médio/Alto | S/M | Registrar novo endpoint webhook | Rápido ganho de inadimplência |
| 6 | **Contas a PAGAR** (boleto de terceiros, DARF, GPS) | Médio | L | Mexe com DINHEIRO SAINDO — risco alto, exige aprovação/controles | Só com demanda clara da coordenação |

## Detalhes por recomendação

### 0. Fix do webhook (hotfix, antes de qualquer feature)
A notificação da Cora chega com corpo vazio e os dados nos headers (`webhook-event-id`,
`webhook-event-type`, `webhook-resource-id`). Nossa rota lê só o corpo → eventos viram
`semIdExterno` (os 2 webhooks "vazios" de produção). Ajustar `extrairEvento` para usar os
headers como fonte primária (corpo como fallback) e responder `{"success": true}`. Idempotência
fica ancorada no `webhook-event-id` nativo — melhor que a chave composta atual. Avaliar
`includeResource: true` no registro do endpoint (recurso no corpo), mas sem depender disso.

### 1. Conciliação bancária (o pedido original)
Página "Extrato" por empresa (MC/CV) lendo `GET /bank-statement/statement`:
- **Match automático** de créditos ↔ boletos pagos (valor + data + CPF/CNPJ da contraparte
  vs `pagador_documento`) com estados: conciliado / divergente / sem correspondência.
- **Visibilidade de tarifas** (`transaction_type=FEE`) — custo bancário por competência.
- Recebimentos fora do sistema aparecem (transparência total do caixa).
- Sinergia com `vw_recebiveis` e o dashboard existente; snapshot diário no Supabase para não
  depender de chamadas mTLS a cada render.
- Limitação a comunicar: sem vínculo nativo extrato↔boleto — o match é heurístico, com fila de
  revisão manual para os divergentes (UX igual à do matching de médicos do Épico 5).

### 2. Pix copia-e-cola
O boleto registrado já sai com Pix; hoje só mandamos o PDF. Expor `pix.emv` na mensagem de
WhatsApp/e-mail ("pague por Pix copiando o código") reduz atrito e prazo de recebimento.
Pré-requisito operacional: confirmar chave Pix cadastrada nas contas MC (e CV quando ativar).

### 3. NFS-e automática
`WAITING_TRIGGER` casa exatamente com nosso fluxo: registrar a NFS-e junto da emissão do
boleto → nota emitida automaticamente na baixa. Perguntas de negócio antes de especificar:
a Carmem emite NFS-e para essas cobranças hoje? Em qual prefeitura (Fortaleza)? Certificado A1
de cada CNPJ (MC/CV) disponível? Webhook `service receipt` fecha o ciclo de auditoria.

### 4/5/6 — ver matriz.

## Próximos passos sugeridos

1. **Dono decide prioridades** (0 é hotfix; 1+2 são o pacote "conciliação" natural).
2. **@pm** cria o épico da conciliação (o assunto "conciliação bancária / plano de contas /
   DRE" já estava listado como candidato a épico no README das stories — esta pesquisa é o
   discovery técnico dele).
3. **@architect** desenha: schema de snapshot do extrato, engine de matching, e o fix 0.
4. **@dev** NÃO deve partir desta pesquisa para código sem passar por arquitetura (regra do
   Architect-First).

## Lembretes operacionais (independentes de feature)

- **Renovação do certificado mTLS**: validade ~12 meses; o da MC foi emitido em 2026-07-09 →
  renovar até ~2027-07 (colocar na agenda).
- **Ambiente stage** existe e nunca foi usado — vale configurar antes de mexer com
  extrato/NFS-e/pagamentos.
- Rate limit conhecido: 100 boletos/6min (folgado para ~120/mês).
