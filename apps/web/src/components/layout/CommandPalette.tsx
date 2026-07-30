'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { medicosService, queryKeys } from '@/services/medicos';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';

interface Item {
  id: string;
  label: string;
  hint: string;
  // Rótulo visível "Emissão" (feedback do dono, 2026-07-30) — a rota /execucoes não muda.
  group: 'Médicos' | 'Emissão' | 'Navegação';
  href: string;
}

/** Paleta de comandos (⌘K / Ctrl+K): busca médicos, execuções e navegação. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Atalho global de abertura/fechamento.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    // Permite abrir via botão (ex.: trigger na sidebar) por evento custom.
    function onOpen() {
      setOpen(true);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('cc:open-command', onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('cc:open-command', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Só busca dados quando a paleta abre (evita fetch desnecessário).
  const { data: medicos } = useQuery({
    queryKey: queryKeys.medicos(),
    queryFn: () => medicosService.listar(),
    enabled: open,
  });
  const { data: execucoes } = useQuery({
    queryKey: execucaoQueryKeys.execucoes(),
    queryFn: () => execucoesService.listar(),
    enabled: open,
  });

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = [
      { id: 'nav-medicos', label: 'Médicos', hint: 'Ver lista', group: 'Navegação', href: '/medicos' },
      { id: 'nav-execucoes', label: 'Emissão', hint: 'Ver histórico', group: 'Navegação', href: '/execucoes' },
      { id: 'nav-nova', label: 'Nova emissão', hint: 'Disparar competência', group: 'Navegação', href: '/execucoes/nova' },
    ];
    const med: Item[] = (medicos ?? []).map((m) => ({
      id: `med-${m.id}`,
      label: m.nome,
      hint: m.cpf ? formatCpf(m.cpf) : '',
      group: 'Médicos',
      href: `/medicos/${m.id}/historico`,
    }));
    const exe: Item[] = (execucoes ?? []).map((e) => ({
      id: `exe-${e.id}`,
      label: e.competencia,
      hint: e.status,
      group: 'Emissão',
      href: `/execucoes/${e.id}`,
    }));
    return [...nav, ...med, ...exe];
  }, [medicos, execucoes]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(term) || i.hint.toLowerCase().includes(term),
    );
  }, [items, q]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  function go(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(filtered[active]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]">
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca rápida"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-cc-hairline bg-cc-surface shadow-cc-lg"
        style={{ animation: 'cc-toast-in 0.2s ease-out both' }}
      >
        <div className="flex items-center gap-3 border-b border-cc-hairline px-4">
          <svg className="text-cc-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar médico, emissão ou página…"
            className="h-12 w-full bg-transparent text-sm text-cc-ink placeholder:text-cc-muted focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-cc-hairline px-1.5 py-0.5 font-mono text-2xs text-cc-muted sm:block">
            ESC
          </kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-cc-muted">Nada encontrado.</li>
          )}
          {filtered.map((item, i) => (
            <li key={item.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  i === active ? 'bg-cc-accent-soft' : ''
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`truncate text-sm ${i === active ? 'text-cc-accent' : 'text-cc-ink'}`}>
                    {item.label}
                  </span>
                  <span className="truncate font-mono text-2xs text-cc-muted">{item.hint}</span>
                </span>
                <span className="shrink-0 rounded bg-cc-surface-2 px-1.5 py-0.5 text-2xs text-cc-muted">
                  {item.group}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function formatCpf(cpf: string): string {
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
