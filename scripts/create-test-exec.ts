import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envStr = fs.readFileSync('.env.production', 'utf-8');
const env = Object.fromEntries(
  envStr.split('\n')
    .filter(line => line.includes('='))
    .map(line => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1).replace(/^"|"$/g, '')];
    })
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL or Key not found in .env.production');
}

const db = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Buscando admin...');
  const { data: admin, error: adminErr } = await db.from('profiles').select('id').eq('papel', 'admin').limit(1).single();
  if (adminErr) throw new Error('Admin not found: ' + adminErr.message);

  console.log('Buscando médico...');
  const { data: medico, error: medicoErr } = await db.from('medicos').select('*').eq('cpf', '11615902341').single();
  if (medicoErr) throw new Error('Medico not found: ' + medicoErr.message);

  console.log('Criando execução...');
  const { data: execucao, error: execErr } = await db.from('execucoes').insert({
    competencia: 'TESTE-07/2026',
    iniciado_por: admin.id,
    status: 'processando'
  }).select('*').single();
  if (execErr) throw new Error('Failed to create execucao: ' + execErr.message);

  console.log('Criando resultado...');
  const { error: resErr } = await db.from('execucao_resultados').insert({
    execucao_id: execucao.id,
    medico_id: medico.id,
    cpf: medico.cpf,
    nome: medico.nome,
    procedimentos: 1,
    cirurgias: 0,
    guias: 1,
    guias_consolidado: 1,
    total_valor: 0.01,
    status: 'ok',
    alertas: []
  });
  if (resErr) throw new Error('Failed to create resultado: ' + resErr.message);

  console.log('Finalizando execução...');
  const { error: updErr } = await db.from('execucoes').update({ 
    status: 'concluido', 
    total_medicos: 1, 
    total_ok: 1,
    total_alerta: 0,
    total_sem_dados: 0, 
    total_geral_valor: 0.01 
  }).eq('id', execucao.id);
  if (updErr) throw new Error('Failed to update execucao: ' + updErr.message);

  console.log('Sucesso! Execução teste criada com id:', execucao.id);
}

run().catch(console.error);
