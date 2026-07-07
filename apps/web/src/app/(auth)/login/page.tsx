'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const markRef = useRef<SVGGElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const rodapeRef = useRef<HTMLParagraphElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.fromTo(
        markRef.current,
        { opacity: 0, y: 20, scale: 0.86, transformOrigin: 'center center' },
        { opacity: 1, y: 0, scale: 1, duration: 0.9 },
      )
        .fromTo(
          brandRef.current,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.5 },
          '-=0.4',
        )
        .fromTo(
          cardRef.current,
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.65 },
          '-=0.3',
        )
        .fromTo(
          rodapeRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.45 },
          '-=0.25',
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
      setErro('E-mail ou senha inválidos. Tente novamente.');
      return;
    }
    router.replace('/medicos');
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cc-bg p-4">


      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Símbolo do C — luminoso, com brilho do accent e giro 3D */}
        <div className="logo-3d-wrap mb-5 justify-center self-center" style={{ width: '100%' }}>
          <svg
            viewBox="360 815 420 430"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Carmem Cavalcante"
            role="img"
            className="logo-3d mx-auto h-20 w-20"
            style={{ fillRule: 'evenodd', clipRule: 'evenodd' }}
          >
            <defs>
              <linearGradient id="silver-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F9F9F9" />
                <stop offset="40%" stopColor="#D4D4D8" />
                <stop offset="60%" stopColor="#71717A" />
                <stop offset="100%" stopColor="#E4E4E7" />
              </linearGradient>
            </defs>
            <g ref={markRef} style={{ opacity: 0 }} fill="url(#silver-grad)">
              <path
                d="M543.776,835.303c-20.332,2.882 -55.873,13.928 -55.873,17.29c0,0.64 5.123,1.921 11.527,3.042c52.511,9.125 99.259,43.866 123.914,92.375c6.564,12.808 6.564,12.808 65.479,13.288c36.502,0.16 59.556,-0.16 60.516,-1.121c2.241,-2.241 -10.887,-28.977 -21.613,-44.507c-17.29,-24.975 -49.79,-52.191 -76.846,-64.359c-33.3,-14.889 -73.804,-20.973 -107.104,-16.01Z"
                fillRule="nonzero"
              />
              <path
                d="M395.687,945.129c-12.487,29.137 -16.65,49.47 -16.65,80.528c0,27.376 3.682,48.029 12.648,70.442c6.084,15.209 6.084,15.209 63.238,15.689c31.379,0.16 56.994,-0.32 56.994,-0.961c0,-0.8 -1.921,-3.042 -4.162,-5.283c-6.884,-6.404 -19.051,-25.775 -24.495,-39.063c-8.005,-19.212 -10.566,-35.381 -8.325,-51.871c3.202,-22.894 14.729,-47.709 30.258,-65.639c3.682,-4.483 6.724,-8.325 6.724,-8.805c0,-0.48 -25.615,-0.961 -56.834,-0.961c-56.834,0 -56.834,0 -59.396,5.924Z"
                fillRule="nonzero"
              />
              <path
                d="M629.267,1091.617c-0.64,1.121 -3.522,6.724 -6.244,12.487c-22.413,46.108 -71.723,82.77 -122.794,91.415c-6.724,1.121 -12.327,2.562 -12.327,3.202c0,2.081 25.295,11.047 40.664,14.729c11.367,2.562 20.172,3.362 40.184,3.362c33.62,0.16 52.992,-3.842 82.449,-16.97c26.736,-12.007 59.396,-39.223 76.526,-64.038c9.766,-14.409 23.534,-41.945 21.933,-44.347c-1.601,-2.722 -118.631,-2.401 -120.392,0.16Z"
                fillRule="nonzero"
              />
            </g>
          </svg>
        </div>

        {/* Wordmark + tagline técnica */}
        <div ref={brandRef} className="mb-6 text-center" style={{ opacity: 0 }}>
          <h1 className="text-lg font-semibold tracking-tight text-cc-ink">Carmem Cavalcante</h1>
          <p className="mt-1 font-mono text-2xs uppercase tracking-[0.25em] text-cc-muted">
            Cobrança por Guias
          </p>
        </div>

        {/* Card do formulário */}
        <div ref={cardRef} className="card p-6 shadow-cc-lg" style={{ opacity: 0 }}>
          <p className="mb-5 text-sm text-cc-ink-2">Acesse sua conta para continuar.</p>
          <form onSubmit={entrar} className="space-y-4">
            <div>
              <label htmlFor="email" className="field-label mb-1.5">E-mail</label>
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
              <label htmlFor="senha" className="field-label mb-1.5">Senha</label>
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
              {carregando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>

        <p ref={rodapeRef} className="mt-5 text-center font-mono text-2xs tracking-wide text-cc-muted" style={{ opacity: 0 }}>
          Acesso restrito a colaboradores autorizados
        </p>
      </div>
    </main>
  );
}
