'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Hook para disparar toasts de qualquer client component. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>');
  return ctx;
}

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++counter;
    setToasts((prev) => [...prev, { id, kind, message }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4200);
    return () => clearTimeout(timer);
  }, [onDone]);

  const accent =
    toast.kind === 'success'
      ? 'text-cc-success'
      : toast.kind === 'error'
        ? 'text-cc-danger'
        : 'text-cc-accent';
  const bar =
    toast.kind === 'success'
      ? 'bg-cc-success'
      : toast.kind === 'error'
        ? 'bg-cc-danger'
        : 'bg-cc-accent';

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-3 overflow-hidden rounded-xl border border-cc-hairline bg-cc-surface p-3 shadow-cc-lg"
      style={{ animation: 'cc-toast-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${accent}`}>
        <Icon kind={toast.kind} />
      </span>
      <p className="flex-1 text-sm text-cc-ink">{toast.message}</p>
      <button
        onClick={onDone}
        aria-label="Fechar"
        className="shrink-0 text-cc-muted transition-colors hover:text-cc-ink"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      {/* barra lateral de acento */}
      <span className={`absolute left-0 top-0 h-full w-1 ${bar}`} />
    </div>
  );
}

function Icon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (kind === 'error') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}
