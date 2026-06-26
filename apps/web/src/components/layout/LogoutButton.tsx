'use client';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function LogoutButton() {
  const router = useRouter();

  async function sair() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      onClick={sair}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-cc-blue transition-colors hover:bg-cc-accent-soft hover:text-cc-navy"
    >
      Sair
    </button>
  );
}
