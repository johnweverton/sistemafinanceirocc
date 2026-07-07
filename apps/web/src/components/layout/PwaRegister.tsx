'use client';
import { useEffect } from 'react';

/** Registra o service worker do PWA (assets estáticos apenas — ver public/sw.js). */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registro falhou (ex.: navegador sem suporte) — app segue funcionando normalmente */
    });
  }, []);

  return null;
}
