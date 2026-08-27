// service-worker.js — Stover: offline app-shell cache.
//
// Caches the app shell (incl. the model + ORT libraries) so the app works offline
// and loads instantly on repeat visits. Inference runs on WebGPU where available,
// with a single-threaded WASM fallback otherwise.
//
// Bump CACHE_VERSION whenever you deploy a new build so users get fresh files.

const CACHE_VERSION = 'stover-v2.0.1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './model.onnx',
  './vendor/exif.js',
  './vendor/jszip.min.js',
  './vendor/FileSaver.js',
  './vendor/jspdf.umd.min.js',
  './vendor/ort.webgpu.min.js',
  './vendor/ort-wasm-simd-threaded.jsep.wasm',
  './vendor/ort-wasm-simd-threaded.jsep.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  './icons/logo.svg',
  './assets/guide/step1_pose.jpg',
  './assets/guide/step2_nadir.jpg',
  './assets/guide/step2_tilted.jpg',
  './demo/demo_1.jpg',
  './demo/demo_2.jpg',
  './demo/demo_3.jpg',
  './demo/demo_4.jpg'
];

// ── Install: pre-cache all shell assets ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: prune stale caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first, then network ─────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
      }
      return response;
    } catch (_) {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    }
  })());
});
