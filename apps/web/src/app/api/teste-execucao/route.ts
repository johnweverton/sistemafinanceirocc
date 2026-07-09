import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db.from('boletos').select('*').order('criado_em', { ascending: false }).limit(1).single();
    if (error) throw error;
    return NextResponse.json({ boleto: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
