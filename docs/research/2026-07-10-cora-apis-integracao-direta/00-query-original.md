# Query original

> "Consulte a documentação de api do banco cora, eu tinha visto a API de conciliação bancária
> que era uma feature que a gente poderia agregar ao nosso sistema, faça uma pesquisa robusta
> e consulta do que as APIs do CORA nos oferece para integração direta no nosso sistema e ter
> mais features e agregar mais valor." — dono, 2026-07-10

## Contexto inferido (auto-clarify)

- **Foco:** técnico (catálogo de APIs + contratos) com viés de descoberta de features.
- **Domínio:** REST API, OAuth2 client_credentials + mTLS, fintech BR (Cora), Next.js + Supabase.
- **Estado atual do sistema:** emite boletos pela API v2 da Cora (invoices), webhook de baixa
  (paid/canceled) registrado, cancelamento e reconsulta implementados, multi-conta (MC +
  Cavalcante Viana) entregue no Épico 7. Conta MC em produção; CV pendente de Cora Pro.
- **Interesse explícito:** API de conciliação bancária (extrato).
