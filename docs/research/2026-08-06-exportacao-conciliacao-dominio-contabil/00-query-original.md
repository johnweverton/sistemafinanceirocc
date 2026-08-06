# Query original

## Pergunta do usuário (verbatim, traduzida do contexto de negócio)

> Não está sincronizando o extrato da Cavalcante Viana, apenas da MC. [resolvido em conversa anterior]
>
> Faça uma pesquisa robusta de como deve ser exportada a conciliação bancária e em qual formato deve
> ser formatado para aceitar nos sistemas contábeis como Domínio, para que a gente, quando concilie,
> consiga fazer a exportação dessas informações do financeiro direto para o contábil, que é onde eles
> irão fazer o lançamento e etc. Se bem que a gente já classifica na DRE, então faça uma pesquisa
> robusta de como implementar essa feature que irá agregar bastante valor. Se atente a todos os
> detalhes, se há algum custo adicional, etc.

## Contexto de negócio já conhecido (fornecido pelo usuário, não repesquisado)

- Já existe um motor de conciliação bancária funcionando (Épico 8, migrations 0020-0022): concilia
  transações de extrato Cora (via API bancária mTLS) com boletos pagos, com matching automático.
- Já existe categorização por plano de contas / DRE (Épico 9): tabelas `plano_contas`,
  `dre_lancamentos`, motor de relatório DRE.
- Objetivo da nova feature: depois de conciliar e categorizar no financeiro, exportar essas
  informações (lançamentos categorizados: data, valor, histórico, categoria/conta contábil,
  contraparte/CPF-CNPJ) num formato que o **Domínio Sistemas** (Thomson Reuters) — sistema usado pelo
  escritório de contabilidade parceiro — aceite para importação direta, eliminando o lançamento
  manual duplicado que o contador faz hoje a partir de planilhas/PDFs.
- 4 contas bancárias Cora (MC, Cavalcante Viana, Carmem Cavalcante, CC Soluções), cada uma ligada a
  um CNPJ/empresa distinto no Domínio.

## Inferred Context (Fase 1 — Auto-Clarify)

- **Foco**: técnico + comparativo (formatos de arquivo, integração vs. arquivo, custo).
- **Domínio tecnológico detectado**: TypeScript, Next.js, Supabase (stack do projeto) + Domínio
  Sistemas, OFX, CNAB, SPED (domínio de contabilidade/fintech brasileira).
- **Clarificação**: não necessária — pergunta já detalhada e com escopo técnico explícito
  (formatos, custo, "todos os detalhes").
