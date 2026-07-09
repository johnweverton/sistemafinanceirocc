import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  try {
    const db = getSupabaseAdmin();
    
    // Buscar primeiro admin
    const { data: admin } = await db.from('profiles').select('id').eq('papel', 'admin').limit(1).single();
    if (!admin) return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    
    // Buscar médico John pelo CPF
    const { data: medico } = await db.from('medicos').select('*').eq('cpf', '11615902341').single();
    if (!medico) return NextResponse.json({ error: 'Medico not found' }, { status: 404 });

    // Verificar se já existe a execução teste para não duplicar
    const { data: existe } = await db.from('execucoes').select('id').eq('competencia', 'TESTE-07/2026').maybeSingle();
    if (existe) {
      return NextResponse.json({ ok: true, message: 'Execução teste já existe', execucaoId: existe.id });
    }

    // Criar execução
    const { data: execucao, error: execErr } = await db.from('execucoes').insert({
      competencia: 'TESTE-07/2026',
      iniciado_por: admin.id,
      status: 'processando'
    }).select('*').single();
    if (execErr) throw new Error(execErr.message);

    // Criar resultado com valor 0,01
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
    if (resErr) throw new Error(resErr.message);

    await db.from('execucoes').update({ 
      status: 'concluido', 
      total_medicos: 1, 
      total_ok: 1,
      total_alerta: 0,
      total_sem_dados: 0, 
      total_geral_valor: 0.01 
    }).eq('id', execucao.id);

    return NextResponse.json({ ok: true, execucaoId: execucao.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
