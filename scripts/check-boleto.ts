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

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await db.from('boletos').select('*').order('criado_em', { ascending: false }).limit(1).single();
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
}

check().catch(console.error);
