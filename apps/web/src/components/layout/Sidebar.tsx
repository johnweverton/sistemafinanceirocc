'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoCC } from '@/components/layout/LogoCC';
import { LogoutButton } from '@/components/layout/LogoutButton';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useSidebar } from '@/components/layout/SidebarContext';

// Item avulso (Dashboard) fica fora de qualquer seção — visão cruzada, não pertence a uma
// vertical só. As duas verticais de cobrança (médica vs contabilidade) ficam em seções
// separadas visualmente (feedback do dono, 2026-07-24), cada uma como um grupo que
// expande/recolhe ao clicar no título (accordion — feedback do dono, 2026-07-30).
const NAV_TOPO = [{ href: '/dashboard', label: 'Dashboard', icon: DashboardIcon }];

const NAV_SECOES = [
  {
    titulo: 'Cobrança Médica',
    itens: [
      { href: '/medicos', label: 'Médicos', icon: MedicosIcon },
      { href: '/empresas', label: 'Empresas', icon: EmpresasIcon },
      // Rótulo visível renomeado de "Execuções" para "Emissão" (feedback do dono, 2026-07-30) —
      // a rota /execucoes e os nomes internos (execucaoId, NovaExecucao...) não mudam.
      { href: '/execucoes', label: 'Emissão', icon: ExecucoesIcon },
      { href: '/recebiveis', label: 'Recebíveis', icon: RecebiveisIcon },
      { href: '/extrato', label: 'Extrato', icon: ExtratoIcon },
      { href: '/dre', label: 'DRE', icon: DreIcon },
      { href: '/relatorios', label: 'Relatórios', icon: RelatoriosIcon },
    ],
  },
  {
    titulo: 'Contabilidade',
    itens: [
      { href: '/clientes-contabilidade', label: 'Clientes Contábeis', icon: ClientesContabeisIcon },
    ],
  },
];

const CHAVE_SECOES = 'cc-sidebar-secoes';

function secoesAbertasPadrao(): Record<string, boolean> {
  return Object.fromEntries(NAV_SECOES.map((s) => [s.titulo, true]));
}

/** Navegação lateral: fixa no desktop (recolhível), drawer deslizante no mobile. */
export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Colapso do modo desktop vive em SidebarContext (compartilhado com o layout, que precisa
  // ajustar o padding do <main> de acordo — feedback do dono 2026-08-03). Accordion das seções
  // (item 3 do feedback 2026-07-30) segue o mesmo padrão de ThemeToggle.tsx: default estável
  // (igual em server e client), só aplica o valor persistido em localStorage DEPOIS de montar,
  // pra não gerar mismatch de hidratação. O conceito de "recolhido" é só para o modo desktop
  // fixo — o drawer mobile sempre abre expandido.
  const { collapsed: efetivamenteColapsada, toggleCollapsed } = useSidebar();
  const [secoesAbertas, setSecoesAbertas] = useState<Record<string, boolean>>(secoesAbertasPadrao);

  useEffect(() => {
    try {
      const secoesSalvas = localStorage.getItem(CHAVE_SECOES);
      if (secoesSalvas) setSecoesAbertas((atual) => ({ ...atual, ...JSON.parse(secoesSalvas) }));
    } catch {
      /* localStorage indisponível — mantém os defaults */
    }
  }, []);

  function toggleSecao(titulo: string) {
    setSecoesAbertas((atual) => {
      const proximo = { ...atual, [titulo]: !atual[titulo] };
      try {
        localStorage.setItem(CHAVE_SECOES, JSON.stringify(proximo));
      } catch {
        /* localStorage indisponível — ignora */
      }
      return proximo;
    });
  }

  // Fecha o drawer ao trocar de rota.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Fecha com Escape e trava o scroll do body enquanto o drawer está aberto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Barra superior — só no mobile */}
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-cc-hairline px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cc-hairline bg-cc-surface-2 text-cc-ink-2 transition-colors hover:border-cc-accent hover:text-cc-accent"
        >
          <HamburgerIcon />
        </button>
        <Link href="/medicos" className="logo-3d-wrap text-cc-accent">
          <LogoCC className="logo-3d logo-3d-slow h-7 w-auto drop-glow" />
        </Link>
        <ThemeToggle />
      </header>

      {/* Backdrop do drawer (mobile) */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Sidebar / Drawer */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-cc-hairline bg-cc-surface transition-transform duration-300 ease-out md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${efetivamenteColapsada ? 'md:w-[76px]' : 'md:w-64'}`}
      >
        {/* Marca */}
        <div className={`flex h-16 items-center gap-3 border-b border-cc-hairline px-5 ${efetivamenteColapsada ? 'md:justify-center md:px-0' : ''}`}>
          <Link href="/medicos" className="logo-3d-wrap group text-cc-accent">
            <LogoCC className="logo-3d logo-3d-slow h-8 w-auto drop-glow" />
          </Link>
          <div className={`min-w-0 ${efetivamenteColapsada ? 'md:hidden' : ''}`}>
            <p className="truncate text-sm font-semibold tracking-tight text-cc-ink">
              Carmem Cavalcante
            </p>
            <p className="truncate font-mono text-2xs uppercase tracking-[0.2em] text-cc-muted">
              Cobrança
            </p>
          </div>
          {/* Fechar (mobile) */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-cc-muted transition-colors hover:text-cc-ink md:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Busca rápida (⌘K) */}
        <div className="p-3 pb-0">
          <button
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent('cc:open-command'))}
            aria-label="Buscar"
            title="Buscar (⌘K)"
            className={`flex w-full items-center gap-2 rounded-lg border border-cc-hairline bg-cc-surface-2 px-3 py-2 text-sm text-cc-muted transition-colors hover:border-cc-accent hover:text-cc-ink ${efetivamenteColapsada ? 'md:justify-center' : ''}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className={`flex-1 text-left ${efetivamenteColapsada ? 'md:hidden' : ''}`}>Buscar…</span>
            <kbd className={`rounded border border-cc-hairline px-1.5 py-0.5 font-mono text-2xs ${efetivamenteColapsada ? 'md:hidden' : ''}`}>⌘K</kbd>
          </button>
        </div>

        {/* Navegação */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_TOPO.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} colapsado={efetivamenteColapsada} />
          ))}

          {efetivamenteColapsada ? (
            // Sidebar recolhida: sem cabeçalho de seção (não há rótulo pra mostrar) — lista os
            // itens de todas as seções em sequência, só com ícones.
            <div className="space-y-1 pt-4 first:pt-1">
              {NAV_SECOES.flatMap((s) => s.itens).map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} colapsado />
              ))}
            </div>
          ) : (
            NAV_SECOES.map((secao) => {
              const aberta = secoesAbertas[secao.titulo] ?? true;
              return (
                <div key={secao.titulo} className="pt-4 first:pt-1">
                  <button
                    type="button"
                    onClick={() => toggleSecao(secao.titulo)}
                    aria-expanded={aberta}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-3 pb-1 text-2xs font-semibold uppercase tracking-[0.15em] text-cc-muted transition-colors hover:text-cc-ink-2"
                  >
                    {secao.titulo}
                    <ChevronIcon className={`shrink-0 transition-transform ${aberta ? '' : '-rotate-90'}`} />
                  </button>
                  {aberta &&
                    secao.itens.map((item) => (
                      <NavLink key={item.href} item={item} pathname={pathname} colapsado={false} />
                    ))}
                </div>
              );
            })
          )}
        </nav>

        {/* Recolher/expandir (só desktop — o drawer mobile não tem esse conceito) */}
        <div className="hidden border-t border-cc-hairline p-3 md:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={efetivamenteColapsada ? 'Expandir menu' : 'Recolher menu'}
            title={efetivamenteColapsada ? 'Expandir menu' : 'Recolher menu'}
            className={`flex w-full items-center gap-2 rounded-lg border border-cc-hairline bg-cc-surface-2 px-3 py-2 text-xs font-medium text-cc-ink-2 transition-colors hover:border-cc-accent hover:text-cc-ink ${efetivamenteColapsada ? 'justify-center' : 'justify-center'}`}
          >
            <CollapseIcon className={efetivamenteColapsada ? 'rotate-180' : ''} />
            {!efetivamenteColapsada && 'Recolher menu'}
          </button>
        </div>

        {/* Rodapé: sair + configurações + tema */}
        <div className={`flex items-center gap-2 border-t border-cc-hairline p-3 ${efetivamenteColapsada ? 'flex-col' : 'justify-between'}`}>
          <LogoutButton />
          <div className="flex items-center gap-2">
            {/* Configurações (item 2 do feedback do dono, 2026-07-30): só o ícone de engrenagem,
                ao lado do botão de tema, em vez de item de navegação cheio. */}
            <Link
              href="/configuracoes"
              aria-label="Configurações"
              title="Configurações"
              aria-current={pathname.startsWith('/configuracoes') ? 'page' : undefined}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-cc-hairline bg-cc-surface-2 transition-all duration-200 hover:border-cc-accent hover:text-cc-accent ${
                pathname.startsWith('/configuracoes') ? 'text-cc-accent' : 'text-cc-ink-2'
              }`}
            >
              <ConfigIcon />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}

/** Um item de navegação — extraído para ser reaproveitado nas áreas do menu (topo/seções). */
function NavLink({
  item,
  pathname,
  colapsado,
}: {
  item: { href: string; label: string; icon: (props: { className?: string }) => React.JSX.Element };
  pathname: string;
  colapsado: boolean;
}) {
  const { href, label, icon: Icon } = item;
  const active = pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={colapsado ? label : undefined}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
        colapsado ? 'md:justify-center' : ''
      } ${
        active
          ? 'bg-cc-accent-soft text-cc-accent'
          : 'text-cc-ink-2 hover:bg-cc-surface-2 hover:text-cc-ink'
      }`}
    >
      {/* Barra de acento à esquerda no item ativo */}
      <span
        className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cc-accent transition-opacity ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <Icon className={`shrink-0 ${active ? 'text-cc-accent' : 'text-cc-muted group-hover:text-cc-ink'}`} />
      <span className={colapsado ? 'md:sr-only' : ''}>{label}</span>
    </Link>
  );
}

function DashboardIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function MedicosIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ExecucoesIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function RecebiveisIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function ExtratoIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 13l3-3 3 2 5-5" />
    </svg>
  );
}

function DreIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4v16h16" />
      <rect x="7" y="12" width="3" height="6" />
      <rect x="12" y="8" width="3" height="10" />
      <rect x="17" y="14" width="3" height="4" />
    </svg>
  );
}

function RelatoriosIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v5a2 2 0 0 0 2 2h5" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

function EmpresasIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />
    </svg>
  );
}

function ClientesContabeisIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  );
}

function ConfigIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CollapseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m14 10-2 2 2 2" />
    </svg>
  );
}
