const CACHE_NAME = "stover-cache-v1"; // Each time you make a change, increment the cache name (e.g., stover-cache-v2).The next time users visit online, the new cache will be fetched.
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo.ico",
  "./logo_192.png",
  "./logo_512.png",
  "./logo_and_text.png",
  "./unet_20250924191812.onnx",
  "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js",
  "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
];

// Install event: cache files
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate event: clean up old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    )
  );
});

// Fetch event: serve cached files or fetch from network
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
