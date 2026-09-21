import { z } from 'zod';
import { LOTE_CONTABILIDADE_MAX_CLIENTES } from '@cobranca/shared';

export const dispararExecucaoSchema = z
  .object({
    competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve ser AAAA-MM'),
    // Cliente contábil (Story 11.3) não tem médicos pra selecionar — só nesse caso o array pode
    // vir vazio (refine abaixo). Nos demais casos (médico normal ou empresa/10.4c) continua
    // exigindo pelo menos 1 seleção.
    selecoes: z
      .array(
        z.object({
          medicoId: z.string().uuid(),
          // Nullable (mas sempre PRESENTE no payload, nunca omitido) a partir do GATE
          // 2026-08-07: médico Angiologista não tem lote principal (a produção dele vem
          // inteira de producaoCateter/Fistula/Angiografia abaixo).
          producaoExternaId: z.string().min(1).nullable(),
          producaoNome: z.string().min(1).nullable(),
          // Produção de consultas de pediatria (Story 10.2) — opcional. Produção FLAT (fin-
          // producoes) inteira usada como consultas — só faz sentido quando a origem já separa
          // guias e consultas em produções de nível-topo distintas.
          producaoConsultasExternaId: z.string().min(1).nullable().optional(),
          producaoConsultasNome: z.string().min(1).nullable().optional(),
          // Sub-lote(s) de consultas de pediatria (achado 2026-08-21): a produção mensal do
          // pediatra pode ter a MESMA estrutura de sub-lotes do Angiologista (fin-lotes) — ex.:
          // "HUMBERTO 1Q"/"HUMBERTO 2Q" (guias) + "HUMBERTO CONSULTAS DE JUNHO" dentro de
          // "JULHO - 2026". Quando o operador marca um sub-lote como consulta aqui, o principal
          // deixa de ser a produção completa (`producaoExternaId`) e passa a ser a SOMA dos
          // demais sub-lotes em `producaoGuiasLoteExternaIds` — nunca os dois ao mesmo tempo,
          // senão os itens do sub-lote de consulta seriam contados 2x (uma vez como guia, uma
          // vez como consulta). Mutuamente exclusivo com `producaoConsultasExternaId` acima.
          producaoConsultasLoteExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoConsultasLoteNomes: z.array(z.string().min(1)).nullable().optional(),
          // Os demais sub-lotes da produção mensal (tudo que NÃO foi marcado como consulta) —
          // computado no cliente a partir da mesma lista de sub-lotes (fin-lotes) e enviado
          // explicitamente para nunca reaproveitar `producaoExternaId` junto (anti-dupla-
          // contagem). Só preenchido quando `producaoConsultasLoteExternaIds` também está.
          producaoGuiasLoteExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoGuiasLoteNomes: z.array(z.string().min(1)).nullable().optional(),
          // Lotes separados de Outros Hospitais/Imobilizações (Story 10.5) — opcionais.
          producaoOutrosHospitaisExternaId: z.string().min(1).nullable().optional(),
          producaoOutrosHospitaisNome: z.string().min(1).nullable().optional(),
          producaoImobilizacoesExternaId: z.string().min(1).nullable().optional(),
          producaoImobilizacoesNome: z.string().min(1).nullable().optional(),
          // Sub-lotes de Imobilizações (achado 2026-08-25, migration 0053; virou ARRAY na migration
          // 0059): médico VH com Imobilizações pode ter a produção mensal inteira dividida em
          // vários sub-lotes por dia/período, nomeados "CIRURGIA*"/"IMOBILIZ*" — a UI classifica
          // pelo nome e soma todos os de cada classe. Mutuamente exclusivo com
          // `producaoImobilizacoesExternaId` acima (produção flat).
          producaoImobilizacoesLoteExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoImobilizacoesLoteNomes: z.array(z.string().min(1)).nullable().optional(),
          // Lotes de Cateter/Fístula/Angiografia (médico Angiologista, GATE 2026-08-07) — opcionais.
          // Arrays desde a migration 0046 (achado 2026-08-13): a origem divide cada categoria em
          // quinzenas (1Q/2Q) como sub-lotes separados, todos somados na mesma execução.
          producaoCateterExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoCateterNomes: z.array(z.string().min(1)).nullable().optional(),
          producaoFistulaExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoFistulaNomes: z.array(z.string().min(1)).nullable().optional(),
          producaoAngiografiaExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoAngiografiaNomes: z.array(z.string().min(1)).nullable().optional(),
          // Carta de Rede (médico Angiologista, GATE 2026-08-12) — contagem MANUAL, sem regra
          // fixa (depende do procedimento realizado no mês). producaoCartaRede* é só referência
          // de auditoria; cartaRedeGuias é o número que de fato alimenta o cálculo.
          producaoCartaRedeExternaId: z.string().min(1).nullable().optional(),
          producaoCartaRedeNome: z.string().min(1).nullable().optional(),
          cartaRedeGuias: z.number().int().min(0).nullable().optional(),
          // Contagem de guias conferida MANUALMENTE pelo dono, importada de planilha (migration
          // 0058, aprovado 2026-09-03; colunas por classe no achado 2026-09-04) — função
          // ALTERNATIVA à contagem automática, aplicada só aos médicos/classes que vierem na
          // planilha (execução mista é o caso normal). Cada campo é independente: guias normais,
          // consultas, imobilizações e outros hospitais têm tabelas de preço diferentes, um total
          // agregado só misturaria classes. `motivo` é obrigatório quando QUALQUER um vier
          // preenchido (refine abaixo): é o texto que aparece no alerta de auditoria do relatório
          // interno, e um alerta "Motivo: não informado" não audita nada.
          guiasManuaisTotal: z.number().int().min(0).nullable().optional(),
          guiasManuaisConsultas: z.number().int().min(0).nullable().optional(),
          guiasManuaisImobilizacoes: z.number().int().min(0).nullable().optional(),
          guiasManuaisOutrosHospitais: z.number().int().min(0).nullable().optional(),
          guiasManuaisMotivo: z.string().trim().min(1).nullable().optional(),
        }),
      )
      .default([]),
    // Marca a execução como agregada por empresa (Story 10.4c) — opcional.
    empresaId: z.string().uuid().optional(),
    // Marca a execução como sendo de cliente contábil (Story 11.3) — opcional.
    clienteContabilidadeId: z.string().uuid().optional(),
    // Marca a execução como o boleto avulso do adicional semestral (Story 11.4) — opcional.
    ehAdicional: z.boolean().optional(),
  })
  .refine((d) => d.selecoes.length >= 1 || !!d.clienteContabilidadeId, {
    message: 'Selecione pelo menos um médico',
    path: ['selecoes'],
  })
  .refine((d) => !(d.empresaId && d.clienteContabilidadeId), {
    message: 'Execução não pode ser de empresa e cliente contábil ao mesmo tempo',
    path: ['clienteContabilidadeId'],
  })
  .refine((d) => !d.ehAdicional || !!d.clienteContabilidadeId, {
    message: 'Adicional semestral só é válido para execução de cliente contábil',
    path: ['ehAdicional'],
  })
  // Auditoria 2026-09-02: nada impedia o operador de apontar a MESMA produção como guias e como
  // consultas — o motor contaria os itens 2x (uma como guia, uma como consulta ambulatorial), e
  // o resultado sairia inflado sem nenhum sinal. A UI não oferece essa combinação hoje, mas o
  // payload é público (rota HTTP) e o custo de barrar aqui é zero.
  .refine(
    (d) =>
      d.selecoes.every(
        (s) =>
          !s.producaoExternaId ||
          !s.producaoConsultasExternaId ||
          s.producaoExternaId !== s.producaoConsultasExternaId,
      ),
    {
      message:
        'A mesma produção não pode ser usada como produção principal e como produção de consultas (contaria em dobro)',
      path: ['selecoes'],
    },
  )
  // Migration 0058: a contagem manual só é auditável se o operador disser POR QUE aquele médico
  // saiu do fluxo automático — o motivo é exatamente o texto que vai para o alerta do relatório
  // interno. Sem ele, o número apareceria no relatório sem nenhuma justificativa e a marca de
  // auditoria viraria enfeite. Barra aqui (payload), não como CHECK de banco: é coerência entre
  // dois campos de uma seleção, mesma responsabilidade das demais regras deste schema.
  .refine(
    (d) =>
      d.selecoes.every(
        (s) =>
          (s.guiasManuaisTotal == null &&
            s.guiasManuaisConsultas == null &&
            s.guiasManuaisImobilizacoes == null &&
            s.guiasManuaisOutrosHospitais == null) ||
          !!s.guiasManuaisMotivo,
      ),
    {
      message: 'Contagem manual de guias exige o motivo preenchido (coluna "motivo" da planilha)',
      path: ['selecoes'],
    },
  )
  // Migration 0059: sub-lotes classificados como Cirurgia (guia principal) e como Imobilizações
  // vêm da MESMA lista de sub-lotes da produção mensal — um mesmo id nos dois arrays contaria o
  // sub-lote 2x (uma vez em cada tabela de preço). A UI nunca gera essa combinação, mas o payload
  // é público (rota HTTP) e o custo de barrar aqui é zero (mesmo espírito do refine de
  // producaoExternaId/producaoConsultasExternaId acima).
  .refine(
    (d) =>
      d.selecoes.every((s) => {
        const guias = new Set(s.producaoGuiasLoteExternaIds ?? []);
        return (s.producaoImobilizacoesLoteExternaIds ?? []).every((id) => !guias.has(id));
      }),
    {
      message:
        'O mesmo sub-lote não pode ser classificado como guia principal e como Imobilizações ao mesmo tempo (contaria em dobro)',
      path: ['selecoes'],
    },
  );

export type DispararExecucaoInput = z.infer<typeof dispararExecucaoSchema>;

// Cálculo em lote de clientes contábeis (feedback do dono, 2026-08-20) — N clientes, 1 execução.
// Mesmo teto de LOTE_CLIENTES_CONTABILIDADE_MAX_ITENS (execucao-orchestrator.ts): duplicado aqui
// de propósito (validação de payload é responsabilidade da camada HTTP, não do orquestrador).
export const dispararLoteClientesContabilidadeSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve ser AAAA-MM'),
  clienteContabilidadeIds: z
    .array(z.string().uuid())
    .min(1, 'Selecione ao menos um cliente contábil')
    .max(
      LOTE_CONTABILIDADE_MAX_CLIENTES,
      `Máximo de ${LOTE_CONTABILIDADE_MAX_CLIENTES} clientes por lote`,
    ),
});

export type DispararLoteClientesContabilidadeInput = z.infer<typeof dispararLoteClientesContabilidadeSchema>;
