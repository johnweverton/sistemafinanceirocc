'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const logoRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const rodapeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.fromTo(
        logoRef.current,
        { opacity: 0, y: 32, scale: 0.94 },
        { opacity: 1, y: 0, scale: 1, duration: 0.85 },
      )
        .fromTo(
          cardRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.65 },
          '-=0.45',
        )
        .fromTo(
          rodapeRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.5 },
          '-=0.3',
        );
    });

    return () => ctx.revert();
  }, []);

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
        {/* Logo com animacao GSAP */}
        <div ref={logoRef} className="mb-8 flex justify-center opacity-0">
          <img
            src="/logo.svg"
            alt="Carmem Cavalcante Contabilidade"
            className="h-20 w-auto"
          />
        </div>

        {/* Card do formulario */}
        <div ref={cardRef} className="card p-6 opacity-0">
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

        <p ref={rodapeRef} className="mt-5 text-center text-xs text-cc-muted opacity-0">
          Acesso restrito a colaboradores autorizados.
        </p>
      </div>
    </main>
  );
}
