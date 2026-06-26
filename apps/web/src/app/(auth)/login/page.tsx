'use client';
import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) {
      setErro('E-mail ou senha invalidos. Tente novamente.');
      return;
    }
    router.replace('/medicos');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cc-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image
            src="/logo.svg"
            alt="Carmem Cavalcante"
            width={200}
            height={60}
            className="h-14 w-auto"
            priority
          />
        </div>

        <div className="card p-6">
          <p className="mb-5 text-sm text-cc-blue">Acesse sua conta para continuar.</p>
          <form onSubmit={entrar} className="space-y-4">
            <div>
              <label htmlFor="email" className="field-label mb-1.5">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="voce@exemplo.com"
              />
            </div>
            <div>
              <label htmlFor="senha" className="field-label mb-1.5">
                Senha
              </label>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="input"
                placeholder="sua senha"
              />
            </div>

            {erro && <p role="alert" className="alert-error py-2">{erro}</p>}

            <button
              type="submit"
              disabled={carregando}
              className="btn-primary w-full py-2.5"
            >
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-cc-muted">
          Acesso restrito a colaboradores autorizados.
        </p>
      </div>
    </main>
  );
}
