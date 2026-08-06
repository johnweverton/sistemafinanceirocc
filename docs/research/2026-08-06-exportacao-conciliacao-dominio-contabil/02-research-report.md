# Relatório de pesquisa — Exportação de conciliação bancária para sistemas contábeis (Domínio Sistemas)

## TL;DR

1. **Domínio Sistemas aceita OFX nativamente** para o módulo de conciliação bancária (junto com OFC
   e Febraban 240) — caminho gratuito, sem custo de licença adicional, e é exatamente o dado que já
   temos em `extrato_transacoes`.
2. **CNAB 240/400 não serve para isto** — é formato de comunicação empresa↔banco para
   remessa/retorno de boletos e pagamentos, não de lançamento contábil. Descartar essa hipótese.
3. **Para os lançamentos contábeis classificados por DRE** (débito/crédito por conta), o Domínio tem
   um layout TXT proprietário de importação (`Utilitários > Importação > Importador`). A
   especificação campo-a-campo exata **não está publicada de forma completa e confiável** fora do
   produto — precisa ser obtida com o escritório de contabilidade parceiro (ver Gaps abaixo).
4. **Não há necessidade de contratar API/integração paga.** As APIs pagas encontradas (SERPRO
   "Integra Contador") são de um serviço GOVERNAMENTAL não relacionado (consulta de obrigações
   fiscais como DAS/DARF), não do Domínio, e não resolvem este caso de uso.
5. **Padrão de mercado confirmado**: outros ERPs brasileiros que já resolveram exatamente este
   problema (Alterdata ERP4ME→Alterdata Contábil, Maxiprod→Domínio) usam **arquivo TXT/Excel +
   importação manual no sistema contábil**, não API em tempo real. Isso valida a abordagem
   recomendada como a prática real do mercado, não uma solução de segunda classe.

---

## 1. Domínio Sistemas — o que ele importa, e onde

Fonte oficial: `suporte.dominioatendimento.com` (HIGH credibility, documentação de suporte da
Thomson Reuters/Domínio).

Existem **dois caminhos de importação DIFERENTES e independentes** no Domínio — é essencial não
confundi-los:

### 1a. Conciliação bancária → **OFX / OFC / Febraban 240**

- Menu: `Utilitários > Importação > Extrato Bancário`.
- O sistema lê as transações do arquivo e usa as tags `MEMO` (primária) ou `NAME` (fallback) para
  identificar cada lançamento na tela de conciliação.
- **Este é o caminho natural para o nosso `extrato_transacoes`** — já temos exatamente esse dado
  (transação bancária individual, com contraparte e valor).
- OFX é o formato recomendado (mais rico que OFC, mais simples que Febraban 240).

### 1b. Lançamentos contábeis (débito/crédito por conta) → **layout TXT proprietário**

- Menu: `Utilitários > Importação > Importador` — fluxo de 2 passos: (1) carregar um "Conjunto de
  Dados" (arquivo de configuração XML que define o layout esperado), depois (2) importar o arquivo
  TXT de dados propriamente dito.
- Um worker de pesquisa encontrou menção a um layout com delimitador pipe (`|`) e códigos de
  registro específicos (ex.: `0010`, `0451`-`0453`). **Sinalizo isso com baixa confiança** — esses
  códigos têm formato muito parecido com blocos do SPED Fiscal (EFD ICMS/IPI), não
  necessariamily do layout de lançamentos contábeis genérico do Domínio; pesquisa web não é
  fonte confiável o suficiente para essa granularidade. **Não implementar a partir desses códigos
  sem confirmação.**
- **SPED ECD (Escrituração Contábil Digital) TAMBÉM pode ser importado** no Domínio (não é só
  formato de saída para o Fisco) — importa primeiro o plano de contas (registro I050), depois os
  lançamentos em partidas múltiplas. Tecnicamente viável, mas ECD é um arquivo de **período fechado
  inteiro** (pensado para migração entre sistemas contábeis ou fechamento anual/mensal formal), não
  para exportações incrementais frequentes — não é a ferramenta certa para "toda vez que eu
  concilio, exporto o que mudou". Descartar como caminho principal; mencionar só como curiosidade.

### 1c. CNAB 240/400 — não se aplica aqui

Confirmado por 2 fontes independentes (TecnoSpeed/FEBRABAN + SOBIT): CNAB é o protocolo de
comunicação **empresa↔banco** para remessa (empresa envia instrução, ex. registrar boleto) e
retorno (banco confirma status, ex. pagamento recebido). Não representa uma partida contábil
(débito/crédito por conta) nem é aceito como tal pelo Domínio. **Não é uma opção para esta feature.**

---

## 2. Custo — sem necessidade de contratar nada adicional

- **Domínio não cobra separadamente pela importação de arquivo (OFX ou TXT proprietário)** — é
  funcionalidade nativa do produto que o escritório de contabilidade já usa/paga.
- Existe uma "Central do Desenvolvedor" do Domínio com API para envio automatizado de **documentos
  fiscais XML** (NF-e, NFC-e, NFS-e, CT-e) — mas isso resolve um problema DIFERENTE (nota fiscal
  eletrônica de ERPs de venda), não lançamento de extrato bancário/DRE. Não é o que precisamos.
- O único custo pago encontrado na pesquisa (**"API Integra Contador"**, ~R$0,24–0,40 por chamada)
  é um serviço do **SERPRO/Receita Federal**, não do Domínio — usado para consultar/enviar
  obrigações fiscais (DAS, guias, extratos fiscais) diretamente ao Fisco. **Não tem relação com
  este projeto** e um worker de pesquisa o citou por confusão de nome ("Integra" aparece nos dois
  contextos). Descartar como fator de custo desta feature.
- **Conclusão de custo: R$ 0,00 de custo de licença/integração adicional** para os dois caminhos de
  arquivo (OFX e TXT de lançamentos) — é trabalho de engenharia interno (gerar o arquivo certo),
  não uma compra.

---

## 3. Especificação técnica do OFX (para implementação)

Fonte: especificação OFX pública + `github.com/chilts/node-ofx` (HIGH/MEDIUM credibility).

Estrutura mínima de uma transação (`<STMTTRN>`), campos **obrigatórios**:

| Tag | Significado | Formato |
|---|---|---|
| `TRNTYPE` | Tipo (`DEBIT`, `CREDIT`, `PAYMENT`, `FEE`, `OTHER`...) | enum |
| `DTPOSTED` | Data da transação | `YYYYMMDD` (ou com hora `YYYYMMDDHHmmss`) |
| `TRNAMT` | Valor, **com sinal** — negativo = saída, positivo = entrada | decimal |
| `FITID` | Id único da transação (evita duplicar na reimportação) | string |

Campos opcionais relevantes: `NAME` (contraparte/histórico, até ~32 caracteres), `MEMO` (detalhe
adicional — é o campo que o Domínio prioriza para exibir na tela de conciliação).

Exemplo mínimo (formato 1.x/SGML, mais simples de gerar manualmente):

```
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260703
<TRNAMT>-1250.00
<FITID>202607030001
<NAME>RENT ACH DEBIT
<MEMO>UNIT 4B JULY
</STMTTRN>
```

Existem 2 versões do padrão: **1.x/SGML** (tags sem fechamento em elementos-folha, mais tolerante,
mais fácil de gerar "na mão") e **2.0+/XML** (bem-formado, tags sempre fechadas). Ambas amplamente
aceitas — o Domínio, especificamente, não exige qual versão nas fontes encontradas; recomenda-se
gerar 1.x/SGML por ser mais simples de implementar sem depender de biblioteca.

**Bibliotecas Node.js/TypeScript encontradas** (para referência, não para copiar/colar):
`node-ofx` (parse **e serialize**, mais madura), `ofx-js` (com tipos TS), `node-ofx-parser`,
`ofx4js`, `ofx-data-extractor`. Dado que o formato SGML é simples (nada além de template
string + concatenação), **é plausível não precisar de nenhuma dependência nova** — gerar o
OFX com um template literal já cobre o caso de uso, evitando adicionar uma lib de terceiros
pouco mantida ao projeto.

---

## 4. Como o mercado resolve isso (precedentes reais)

| Sistema | Formato de saída | Caminho |
|---|---|---|
| Alterdata ERP4ME → Alterdata Contábil | TXT (layout "Wcont") | Exportar do ERP → importar manualmente no módulo contábil, após mapear contas |
| Maxiprod → **Domínio** (mesmíssimo alvo nosso) | Excel (.xlsx), com fallback CSV/TXT | Exportar planilha → (se incompatível) converter pra TXT → importar em Domínio |
| Trinks (fintech) → Conta Azul/Granatum/Nibo/F360° | Layout proprietário por ERP de destino (não genérico) | Selecionar ERP de destino → exportar formato específico |
| Conta Azul (extrato bancário) | OFX | Conciliação automática — confirma OFX como padrão de MERCADO pra conciliação, não só do Domínio |

**Padrão universal confirmado**: nenhum concorrente usa API em tempo real para esse tipo de
integração — todos usam **arquivo gerado + importação manual no sistema contábil**, com
**parametrização prévia obrigatória** (mapear conta bancária/categoria do ERP para a conta contábil
correspondente no sistema de destino, uma vez só, não a cada exportação). Isso confirma que a
abordagem "gerar arquivo" não é uma solução inferior — é como o mercado inteiro resolve isso,
incluindo concorrentes maduros integrando com o próprio Domínio.

---

## Gaps / o que não foi possível confirmar com certeza pela pesquisa web

1. **Especificação campo-a-campo exata do layout TXT de lançamentos contábeis do Domínio.** A
   pesquisa web encontrou a EXISTÊNCIA do mecanismo (Importador + Conjunto de Dados XML) mas não
   uma especificação pública, verificada e completa dos campos/posições/delimitador. Isso é
   normal — é um artefato de configuração dentro do produto, tipicamente compartilhado
   escritório-a-escritório, não documentado publicamente de forma genérica.
2. Não foi possível confirmar se a versão de Domínio usada pelo escritório parceiro é recente o
   suficiente para o fluxo de "Conjunto de Dados" descrito, nem a codificação de caracteres
   esperada (Latin-1/CP1252 é comum em sistemas legados brasileiros — os campos `CHARSET`/`1252`
   apareceram inclusive na spec do OFX 1.x pesquisada).

Ver `03-recommendations.md` para como isso não bloqueia o início da implementação.
