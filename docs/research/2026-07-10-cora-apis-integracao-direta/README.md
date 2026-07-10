# Pesquisa — APIs da Cora (Integração Direta): catálogo e oportunidades

**Data:** 2026-07-10 · **Pipeline:** tech-search (5 workers, wave 1, cobertura ~85%)

## TL;DR

A Integração Direta da Cora oferece **muito mais** do que a emissão de boletos que já usamos:

1. **Extrato/conciliação** (`GET /bank-statement/statement`) — créditos/débitos com filtros, paginação e agregações. **Não há vínculo explícito extrato↔boleto** — conciliação é por heurística (valor+data+contraparte).
2. **Saldo e dados de conta** (`GET /third-party/account/balance`) — posição de caixa em tempo real (por conta: MC e Cavalcante Viana).
3. **Contas a pagar** — iniciar/agendar pagamentos de boletos de terceiros (código de barras + data), DARF e GPS.
4. **NFS-e** — emissão de nota fiscal de serviço vinculada à cobrança, inclusive **automática quando o boleto é pago** (`WAITING_TRIGGER`). Exige certificado A1 e-CNPJ + credenciais da prefeitura. ~R$ 0,49/nota.
5. **Pix na invoice** — `payment_forms: ['PIX']` gera QR dinâmico + copia-e-cola (`pix.emv`) na mesma cobrança (exige chave Pix cadastrada na conta).
6. **Webhooks além de invoice** — resources: invoice, transfer, payment, register, service receipt (NFS-e), com triggers enumerados.

**🔥 Descoberta lateral:** o exemplo oficial de notificação de webhook tem `content-length: 0` — os dados do evento vêm nos **HEADERS** (`webhook-event-id`, `webhook-event-type`, `webhook-resource-id`), não no corpo. Isso explica os 2 webhooks "vazios" que recebemos em produção (2026-07-10): nossa rota lê só o body. Fix pequeno e de alto valor.

## Arquivos

| Arquivo | Conteúdo |
|---------|----------|
| `00-query-original.md` | Pergunta original + contexto inferido |
| `01-deep-research-prompt.md` | Sub-queries e estratégia |
| `02-research-report.md` | Achados completos por tema, com contratos e fontes |
| `03-recommendations.md` | Features ranqueadas por valor/esforço + próximos passos |
