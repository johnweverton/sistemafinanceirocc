// Aplica em lote a parametrização de médicos levantada em 2026-07-30/31 cruzando a planilha de
// produção médica (Downloads/base de dados/planilha producao Medica 2026 - arcus (1).xlsx) com o
// cadastro real: (1) conta emissora MC→Cavalcante Viana pros casos DIVERGE sem ambiguidade;
// (2) especialidade='Pediatria' pros médicos com consultas pediátricas confirmadas;
// (3) faz_outros_hospitais/faz_imobilizacoes pros médicos com produção confirmada nos 2 meses
// mais recentes (mai/jun 2026). Casos ambíguos ou que precisam de decisão da coordenação
// (Osvaldo/Ortopedia, Pedro Hans/imobilizações descontinuada, Lucas, Felipe) foram
// DELIBERADAMENTE deixados fora — ver scratchpad/plano-aplicacao-medicos.md.
//
// Idempotente: cada linha checa o valor atual antes de escrever e pula se já estiver certo.
// Grava o diff em medicos_historico, mesmo padrão de atualizarMedico (medico-repository.ts).
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

const MOTIVO_CONTA =
  'Correção de conta emissora a partir da planilha de produção médica (aba Cavalcante Viana ' +
  'jun/2026) — cadastro estava com o default "mc" e nunca tinha sido ajustado por médico.';
const MOTIVO_CADASTRO =
  'Parametrização de cadastro a partir da planilha de produção médica (mai/jun 2026) — ' +
  'especialidade/lote de produção confirmados mas nunca preenchidos no cadastro.';

async function admin() {
  const { data, error } = await db.from('profiles').select('id').eq('papel', 'admin').limit(1).single();
  if (error) throw new Error('Admin não encontrado: ' + error.message);
  return data.id as string;
}

async function historico(medicoId: string, campo: string, anterior: unknown, novo: unknown, autorId: string, motivo: string) {
  const { error } = await db.from('medicos_historico').insert({
    medico_id: medicoId,
    campo_alterado: campo,
    valor_anterior: String(anterior ?? ''),
    valor_novo: String(novo ?? ''),
    alterado_por: autorId,
    motivo,
  });
  if (error) throw new Error(`histórico falhou (${campo}): ${error.message}`);
}

// --- Parte 1: conta emissora (61 candidatos DIVERGE do CSV) -----------------------------------
async function aplicarContaEmissora(autorId: string) {
  const csv = fs.readFileSync(
    'C:\\Users\\john2\\AppData\\Local\\Temp\\claude\\C--Users-john2-OneDrive-Sistema-Financeiro\\6cd19cd3-07db-41b4-b79d-5e0ab5a568fe\\scratchpad\\medicos_divergencia_conta_emissora.csv',
    'utf-8',
  );
  const linhas = csv.split('\n').slice(1).filter((l) => l.trim());
  let aplicados = 0, pulados = 0, falhas = 0;

  for (const linha of linhas) {
    // status pode ter vírgula dentro de aspas (casos AMBIGUO) — só nos interessa DIVERGE, que
    // nunca tem vírgula extra, então split simples basta pra esses.
    const campos = linha.split(',');
    const status = campos[campos.length - 1]?.trim();
    if (status !== 'DIVERGE') continue;

    const nomeBanco = campos[1];
    const externalId = campos[4];
    if (!externalId) continue;

    const { data: atual, error: buscaErr } = await db
      .from('medicos')
      .select('id, nome, conta_emissora')
      .eq('external_id', externalId)
      .single();
    if (buscaErr || !atual) {
      console.error(`✗ conta_emissora ${nomeBanco} (external_id ${externalId}): não encontrado`);
      falhas++;
      continue;
    }
    if (atual.conta_emissora === 'cavalcante_viana') {
      pulados++;
      continue;
    }

    const { error: updErr } = await db
      .from('medicos')
      .update({ conta_emissora: 'cavalcante_viana', updated_at: new Date().toISOString() })
      .eq('id', atual.id);
    if (updErr) {
      console.error(`✗ conta_emissora ${atual.nome}: ${updErr.message}`);
      falhas++;
      continue;
    }
    await historico(atual.id, 'contaEmissora', atual.conta_emissora, 'cavalcante_viana', autorId, MOTIVO_CONTA);
    aplicados++;
  }
  console.log(`\nConta emissora: ${aplicados} aplicados, ${pulados} já corretos, ${falhas} falhas.`);
}

// --- Parte 2: pediatria / outros hospitais / imobilizações (JSON já com id do cadastro) -------
type Mudanca = {
  id: string;
  nome: string;
  campo: 'especialidade' | 'faz_outros_hospitais' | 'faz_imobilizacoes';
  valorNovo: string | boolean;
  categoria: string;
};

async function aplicarCadastro(autorId: string) {
  const plano = JSON.parse(
    fs.readFileSync(
      'C:\\Users\\john2\\AppData\\Local\\Temp\\claude\\C--Users-john2-OneDrive-Sistema-Financeiro\\6cd19cd3-07db-41b4-b79d-5e0ab5a568fe\\scratchpad\\plano-aplicacao-medicos.json',
      'utf-8',
    ),
  );
  const mudancas: Mudanca[] = plano.mudancas;
  let aplicados = 0, pulados = 0, falhas = 0;

  for (const m of mudancas) {
    const { data: atual, error: buscaErr } = await db
      .from('medicos')
      .select(`id, nome, ${m.campo}`)
      .eq('id', m.id)
      .single();
    if (buscaErr || !atual) {
      console.error(`✗ ${m.categoria} ${m.nome}: não encontrado (${buscaErr?.message})`);
      falhas++;
      continue;
    }
    const atualRec = atual as unknown as Record<string, unknown>;
    if (atualRec[m.campo] === m.valorNovo) {
      pulados++;
      continue;
    }

    const { error: updErr } = await db
      .from('medicos')
      .update({ [m.campo]: m.valorNovo, updated_at: new Date().toISOString() })
      .eq('id', m.id);
    if (updErr) {
      console.error(`✗ ${m.categoria} ${m.nome}: ${updErr.message}`);
      falhas++;
      continue;
    }
    // campo_alterado no histórico usa o nome camelCase do domínio (mesmo padrão do resto do app).
    const campoDominio = m.campo === 'especialidade' ? 'especialidade'
      : m.campo === 'faz_outros_hospitais' ? 'fazOutrosHospitais'
      : 'fazImobilizacoes';
    await historico(m.id, campoDominio, atualRec[m.campo], m.valorNovo, autorId, MOTIVO_CADASTRO);
    aplicados++;
    console.log(`✓ ${m.categoria}: ${m.nome} → ${m.campo}=${m.valorNovo}`);
  }
  console.log(`\nCadastro (pediatria/outros hospitais/imobilizações): ${aplicados} aplicados, ${pulados} já corretos, ${falhas} falhas.`);
}

async function run() {
  const autorId = await admin();
  await aplicarContaEmissora(autorId);
  await aplicarCadastro(autorId);
}

run().catch((e) => {
  console.error('Falha geral:', e);
  process.exit(1);
});
