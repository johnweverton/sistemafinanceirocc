'use client';
import { useState } from 'react';
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
        {/* Logo mark */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-cc-accent shadow-cc-md">
            <span className="text-sm font-bold text-white tracking-tight">CC</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-cc-ink">
            Carmem Cavalcante
          </h1>
          <p className="mt-1 text-sm text-cc-muted">Contabilidade e Cobranca por Guias</p>
        </div>

        {/* Card do formulario */}
        <div className="card p-6">
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

            {erro && (
              <p role="alert" className="alert-error py-2">
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={carregando}
              className="btn-primary w-full py-2.5"
            >
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-cc-muted">
          Acesso restrito a colaboradores autorizados.
        </p>
      </div>
    </main>
  );
}
