// Aplica ao cadastro real os 5 overrides de preço próprio da lista canônica (docs/stories/
// 10.1.overrides-preco-medico.story.md, GATE do dono 2026-07-20) — valores confirmados também
// pela revalidação do motor em 2026-07-30/31 (scratchpad/relatorio-validacao-motor.md).
// Reproduz manualmente o mesmo efeito de `atualizarMedico` (medico-repository.ts): grava a
// mudança em `medicos` E o diff em `medicos_historico`, com motivo obrigatório.
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envStr = fs.readFileSync('apps/web/.env.local', 'utf-8');
const env = Object.fromEntries(
  envStr.split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1).replace(/^"|"$/g, '')];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const MOTIVO =
  'Aplicação do override de preço próprio da Story 10.1 (GATE do dono 2026-07-20) — cadastro ' +
  'nunca tinha sido atualizado para usar o mecanismo já implementado; valores confirmados pela ' +
  'story e revalidados contra a planilha em 2026-07-30/31.';

type RegraPreco = {
  forma: 'por_guia' | 'base_excedente' | 'fixo';
  base?: number | null;
  limiar?: number | null;
  taxa?: number | null;
  valorFixo?: number | null;
};

const OVERRIDES: { nome: string; regraPreco: RegraPreco }[] = [
  { nome: 'EZEQUIEL AGUIAR PARENTE', regraPreco: { forma: 'por_guia', taxa: 4.0 } },
  {
    nome: 'JANSEN DE SOUSA GOMES',
    regraPreco: { forma: 'base_excedente', base: 935.62, limiar: 144, taxa: 6.5 },
  },
  { nome: 'NELSON MAGNO MAGALHÃES FREITAS', regraPreco: { forma: 'fixo', valorFixo: 591.22 } },
  { nome: 'CARLOS ALBERTO MIRANDA BATISTA', regraPreco: { forma: 'fixo', valorFixo: 591.22 } },
  { nome: 'JEFFERSON MENEZES VIANA SANTOS', regraPreco: { forma: 'fixo', valorFixo: 130.53 } },
];

function toRow(rp: RegraPreco) {
  // medicos só tem estas 5 colunas de regra_preco_* — valor_abaixo/acima_limiar são exclusivas
  // de empresas/clientes_contabilidade (forma faixa_faturamento, Story 11.1), não existem aqui.
  return {
    regra_preco_forma: rp.forma,
    regra_preco_base: rp.base ?? null,
    regra_preco_limiar: rp.limiar ?? null,
    regra_preco_taxa: rp.taxa ?? null,
    regra_preco_valor_fixo: rp.valorFixo ?? null,
  };
}

async function run() {
  const { data: admin, error: adminErr } = await db
    .from('profiles')
    .select('id')
    .eq('papel', 'admin')
    .limit(1)
    .single();
  if (adminErr) throw new Error('Admin não encontrado: ' + adminErr.message);

  for (const o of OVERRIDES) {
    const { data: atual, error: buscaErr } = await db
      .from('medicos')
      .select('id, nome, modo_cobranca, regra_preco_forma, regra_preco_base, regra_preco_limiar, regra_preco_taxa, regra_preco_valor_fixo')
      .eq('nome', o.nome)
      .single();
    if (buscaErr || !atual) {
      console.error(`✗ ${o.nome}: não encontrado (${buscaErr?.message ?? 'sem linha'})`);
      continue;
    }

    if (atual.modo_cobranca === 'preco_proprio') {
      console.log(`= ${o.nome}: já está em preco_proprio, pulando (idempotente).`);
      continue;
    }

    const row = toRow(o.regraPreco);
    const { error: updErr } = await db
      .from('medicos')
      .update({ modo_cobranca: 'preco_proprio', ...row, updated_at: new Date().toISOString() })
      .eq('id', atual.id);
    if (updErr) {
      console.error(`✗ ${o.nome}: falha no update — ${updErr.message}`);
      continue;
    }

    const historico = [
      {
        medico_id: atual.id,
        campo_alterado: 'modoCobranca',
        valor_anterior: String(atual.modo_cobranca ?? ''),
        valor_novo: 'preco_proprio',
        alterado_por: admin.id,
        motivo: MOTIVO,
      },
      {
        medico_id: atual.id,
        campo_alterado: 'regraPreco',
        valor_anterior: JSON.stringify({
          forma: atual.regra_preco_forma,
          base: atual.regra_preco_base,
          limiar: atual.regra_preco_limiar,
          taxa: atual.regra_preco_taxa,
          valorFixo: atual.regra_preco_valor_fixo,
        }),
        valor_novo: JSON.stringify(o.regraPreco),
        alterado_por: admin.id,
        motivo: MOTIVO,
      },
    ];
    const { error: histErr } = await db.from('medicos_historico').insert(historico);
    if (histErr) {
      console.error(`⚠ ${o.nome}: update OK mas histórico falhou — ${histErr.message}`);
      continue;
    }

    console.log(`✓ ${o.nome}: preco_proprio (${o.regraPreco.forma}) aplicado + histórico gravado.`);
  }
}

run().catch((e) => {
  console.error('Falha geral:', e);
  process.exit(1);
});
