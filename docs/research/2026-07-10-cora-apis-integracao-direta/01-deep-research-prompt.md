# Decomposição da pesquisa (Fase 2)

**Tópico principal:** Catálogo completo das APIs da Integração Direta da Cora e oportunidades
de features para o sistema de cobrança.

## Sub-queries despachadas (5 workers Haiku, paralelo)

1. **Extrato/conciliação** — contrato completo do endpoint de bank statement: path, params,
   schema de resposta, paginação, e se existe vínculo extrato↔invoice.
2. **Catálogo geral** — todos os grupos de recursos da Integração Direta com paths.
3. **Webhooks** — resources e triggers disponíveis, payload, retry, autenticação.
4. **NFS-e + Pix** — fluxo de nota fiscal (certificado A1, endpoints, vínculo com cobrança) e
   capacidades Pix (QR na invoice, cobrança avulsa, transferência).
5. **Devil's advocate** — limitações: o que exige Cora Pro, rate limits, escopos do token,
   sandbox/stage, validade do mTLS, reclamações de desenvolvedores.

## Ferramentas

Exa/Context7 indisponíveis na sessão → WebSearch + WebFetch (doc oficial developers.cora.com.br
priorizada). Fase 4 (avaliação de cobertura) executada inline no modelo principal — desvio
documentado do pipeline (economia de um worker; julgamento trivial com 5/5 sucessos).

**Resultado:** wave 1 suficiente — cobertura ~85%, 15+ fontes HIGH. STOP.
