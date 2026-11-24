// service-worker.js (site root) — retires the web app's old service worker.
//
// The web app used to live at the site root (soilwater.github.io/stover/), so browsers that installed it
// have a service worker controlling the whole site, which would keep showing the old app instead of the
// landing page. When those browsers check for an update they get this file, which deletes the old app's
// caches, unregisters itself, and reloads open pages. The web app now has its own service worker in app/.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('stover-v')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach((page) => page.navigate(page.url));
  })());
});
