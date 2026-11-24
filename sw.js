// Service worker: permite jugar sin conexión.
// Estrategia "primero la red": siempre se carga la última versión publicada
// y, si no hay internet, se usa la copia guardada.
// Al agregar archivos nuevos al juego, sumalos a CORE (un test lo verifica).
const CACHE = 'invaders-v2.1.0';

const CORE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/game.js',
  './src/sound.js',
  './src/storage.js',
  './src/platform.js',
  './img/spaceship.png',
  './img/invader.png',
  './assets/fonts/press-start-2p-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('invaders-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Sólo archivos propios: el ranking online y otros servicios van directo a la red.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: req.mode === 'navigate' })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
          .then((hit) => hit || Response.error()),
      ),
  );
});
