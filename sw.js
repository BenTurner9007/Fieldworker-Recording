// Service worker: caches the app so it opens with no signal.
// Bump VERSION whenever app files change so devices pick up the update.
const VERSION = 'v2';
const CACHE = `fieldworker-${VERSION}`;
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/styles.css', './config.js', './js/vendor/supabase.js', './js/sync.js',
  './js/app.js', './js/db.js', './js/schema.js', './js/osgb.js', './js/export.js', './js/matrix.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive when online), cache as fallback offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
