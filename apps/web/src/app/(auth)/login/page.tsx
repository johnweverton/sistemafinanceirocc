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

  const markRef  = useRef<SVGGElement>(null);
  const textRef  = useRef<SVGGElement>(null);
  const cardRef  = useRef<HTMLDivElement>(null);
  const rodapeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      /* 1. Simbolo da marca aparece e sobe */
      tl.fromTo(
        markRef.current,
        { opacity: 0, y: 18, scale: 0.88, transformOrigin: 'center center' },
        { opacity: 1, y: 0, scale: 1, duration: 0.75 },
      )
      /* 2. Texto desliza da esquerda com ligeiro delay */
      .fromTo(
        textRef.current,
        { opacity: 0, x: -14 },
        { opacity: 1, x: 0, duration: 0.65 },
        '-=0.5',
      )
      /* 3. Card do formulario sobe */
      .fromTo(
        cardRef.current,
        { opacity: 0, y: 22 },
        { opacity: 1, y: 0, duration: 0.6 },
        '-=0.35',
      )
      /* 4. Rodape dissolve */
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
      setErro('E-mail ou senha invalidos. Tente novamente.');
      return;
    }
    router.replace('/medicos');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cc-bg p-4">
      <div className="w-full max-w-sm">

        {/* Logo inline — sem fundo branco, animavel por GSAP */}
        <div className="mb-8 flex justify-center">
          <svg
            viewBox="330 808 1360 450"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Carmem Cavalcante Contabilidade"
            role="img"
            className="h-24 w-auto"
            style={{ fillRule: 'evenodd', clipRule: 'evenodd' }}
          >
            {/* Simbolo (3 paths do C) */}
            <g ref={markRef} style={{ opacity: 0 }}>
              <path
                d="M543.776,835.303c-20.332,2.882 -55.873,13.928 -55.873,17.29c0,0.64 5.123,1.921 11.527,3.042c52.511,9.125 99.259,43.866 123.914,92.375c6.564,12.808 6.564,12.808 65.479,13.288c36.502,0.16 59.556,-0.16 60.516,-1.121c2.241,-2.241 -10.887,-28.977 -21.613,-44.507c-17.29,-24.975 -49.79,-52.191 -76.846,-64.359c-33.3,-14.889 -73.804,-20.973 -107.104,-16.01Z"
                fill="#01254c" fillRule="nonzero"
              />
              <path
                d="M395.687,945.129c-12.487,29.137 -16.65,49.47 -16.65,80.528c0,27.376 3.682,48.029 12.648,70.442c6.084,15.209 6.084,15.209 63.238,15.689c31.379,0.16 56.994,-0.32 56.994,-0.961c0,-0.8 -1.921,-3.042 -4.162,-5.283c-6.884,-6.404 -19.051,-25.775 -24.495,-39.063c-8.005,-19.212 -10.566,-35.381 -8.325,-51.871c3.202,-22.894 14.729,-47.709 30.258,-65.639c3.682,-4.483 6.724,-8.325 6.724,-8.805c0,-0.48 -25.615,-0.961 -56.834,-0.961c-56.834,0 -56.834,0 -59.396,5.924Z"
                fill="#01254c" fillRule="nonzero"
              />
              <path
                d="M629.267,1091.617c-0.64,1.121 -3.522,6.724 -6.244,12.487c-22.413,46.108 -71.723,82.77 -122.794,91.415c-6.724,1.121 -12.327,2.562 -12.327,3.202c0,2.081 25.295,11.047 40.664,14.729c11.367,2.562 20.172,3.362 40.184,3.362c33.62,0.16 52.992,-3.842 82.449,-16.97c26.736,-12.007 59.396,-39.223 76.526,-64.038c9.766,-14.409 23.534,-41.945 21.933,-44.347c-1.601,-2.722 -118.631,-2.401 -120.392,0.16Z"
                fill="#01254c" fillRule="nonzero"
              />
            </g>

            {/* Texto da marca */}
            <g
              ref={textRef}
              style={{ opacity: 0, fontFamily: "'CodecColdTrial-Bold','Codec Cold Trial','Barlow Condensed','Arial Narrow',sans-serif" }}
              transform="matrix(2.373786,0,0,2.373786,-2299.425237,-1495.957318)"
            >
              <text x="1331.212" y="1043.943" fontWeight="700" fontSize="50" fill="#01254c">
                COBRAN&#xC7;A
              </text>
              <text x="1331.212" y="1085.609" fontWeight="700" fontSize="50" fill="#01254c">
                CARMEM
              </text>
              <text x="1331.212" y="1127.276" fontWeight="900" fontSize="50" fill="#01254c">
                CAVALCANTE
              </text>
            </g>
          </svg>
        </div>

        {/* Card do formulario */}
        <div ref={cardRef} className="card p-6" style={{ opacity: 0 }}>
          <p className="mb-5 text-sm text-cc-blue">Acesse sua conta para continuar.</p>
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
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p ref={rodapeRef} className="mt-5 text-center text-xs text-cc-muted" style={{ opacity: 0 }}>
          Acesso restrito a colaboradores autorizados.
        </p>
      </div>
    </main>
  );
}
