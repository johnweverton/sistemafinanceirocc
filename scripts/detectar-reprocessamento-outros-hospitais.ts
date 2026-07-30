// Story 10.5 — script de diagnóstico (não automático): lista execuções concluídas, com boleto
// AINDA NÃO emitido, de médicos que fazem Outros Hospitais/Imobilizações — candidatas a
// reprocessar manualmente na tela "Nova Execução" (agora com os seletores de lote separado)
// antes de emitir o boleto. Não reprocessa nada sozinho: a escolha do lote certo por médico é
// sempre manual (nunca auto-match, decisão já validada nas Stories 10.2/10.5).
//
// Sinal de "provavelmente pegou o bug": 2+ subtotais da mesma linha com a MESMA contagem de
// guias (ex.: HAPVIDA_CRED 50 guias + OUTROS_HOSPITAIS 50 guias) — assinatura do motor antigo,
// que reaproveitava a contagem do lote principal em vez de contar o lote separado.
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envStr = fs.readFileSync('.env.production', 'utf-8');
const env = Object.fromEntries(
  envStr.split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1).replace(/^"|"$/g, '')];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

interface Subtotal {
  classe: string;
  guias: number;
  valor: number;
  faixa: string;
}

async function main() {
  const { data: medicos, error: medicosErr } = await db
    .from('medicos')
    .select('id, nome, faz_outros_hospitais, faz_imobilizacoes')
    .or('faz_outros_hospitais.eq.true,faz_imobilizacoes.eq.true');
  if (medicosErr) throw medicosErr;
  if (!medicos || medicos.length === 0) {
    console.log('Nenhum médico com Outros Hospitais/Imobilizações cadastrado.');
    return;
  }

  const medicoIds = medicos.map((m) => m.id);
  const medicoPorId = new Map(medicos.map((m) => [m.id, m]));

  const { data: resultados, error: resultadosErr } = await db
    .from('execucao_resultados')
    .select('id, medico_id, nome, guias, subtotais, total_valor, status, execucoes!inner(competencia, status)')
    .in('medico_id', medicoIds)
    .in('status', ['ok', 'alerta'])
    .eq('execucoes.status', 'concluido');
  if (resultadosErr) throw resultadosErr;
  if (!resultados || resultados.length === 0) {
    console.log('Nenhum resultado concluído encontrado para esses médicos.');
    return;
  }

  const { data: boletos, error: boletosErr } = await db
    .from('boletos')
    .select('execucao_resultado_id');
  if (boletosErr) throw boletosErr;
  const resultadosComBoleto = new Set((boletos ?? []).map((b) => b.execucao_resultado_id));

  const pendentes = resultados.filter((r) => !resultadosComBoleto.has(r.id));

  console.log(`${pendentes.length} resultado(s) sem boleto emitido para médicos de Outros Hospitais/Imobilizações:\n`);

  for (const r of pendentes) {
    const medico = medicoPorId.get(r.medico_id ?? '');
    const subtotais = (r.subtotais ?? []) as Subtotal[];
    const guiasPorClasse = subtotais.map((s) => `${s.classe}=${s.guias}g/R$${s.valor.toFixed(2)}`).join(' + ');

    // Assinatura do bug antigo: 2+ classes com a MESMA contagem de guias.
    const contagens = subtotais.map((s) => s.guias);
    const suspeito = contagens.length >= 2 && new Set(contagens).size < contagens.length;

    const execucao = (r as unknown as { execucoes: { competencia: string } }).execucoes;
    console.log(
      `${suspeito ? '⚠️  SUSPEITO' : '  '} ${r.nome} — competência ${execucao.competencia} — ` +
        `total R$${(r.total_valor ?? 0).toFixed(2)} — ${guiasPorClasse} — ` +
        `flags: outros_hospitais=${medico?.faz_outros_hospitais} imobilizacoes=${medico?.faz_imobilizacoes}`,
    );
  }

  console.log(
    '\nPara corrigir: reabrir "Nova Execução" → Por médico, selecionar a competência e os lotes' +
      ' separados corretos (Outros Hospitais/Imobilizações) antes de emitir o boleto.',
  );
}

main().catch(console.error);
