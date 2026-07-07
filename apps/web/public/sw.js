// Service Worker do PWA "CCC".
// Escopo deliberadamente restrito: cacheia apenas assets estaticos e nao-sensiveis
// (icones, manifest, logo). NUNCA cacheia HTML, rotas da API ou dados do Supabase —
// este e um sistema de cobranca com dados financeiros/medicos sensiveis, e o Cache
// Storage nao e limpo no logout, entao paginas ou respostas de API em cache
// seriam um vazamento de dados persistente no dispositivo.

const CACHE_NAME = 'ccc-static-v1';
const STATIC_ASSETS = [
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isStaticAsset = url.origin === self.location.origin && STATIC_ASSETS.includes(url.pathname);
  if (!isStaticAsset) return; // deixa passar pro network — sem cache de HTML/API/dados

  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
