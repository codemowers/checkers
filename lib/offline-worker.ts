/** Only the public local shell and explicit build assets enter this cache. */
export function offlineWorkerSource(cacheName: string, assets: string[]) {
  return `
const CACHE = ${JSON.stringify(cacheName)};
const ASSETS = ${JSON.stringify(assets)};
const STATIC = new Set(ASSETS.filter(path => path !== '/local'));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(ASSETS.map(path => new Request(path, {credentials:'omit', cache:'reload'})));
      await self.skipWaiting();
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('checkers-local-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/local')) {
    event.respondWith((async () => {
      const aborter = new AbortController();
      const timer = setTimeout(() => aborter.abort(), 4000);
      try {
        const response = await fetch(request, {signal:aborter.signal});
        // Never cache an authenticated home page, redirect or error response.
        // The installed shell stays paired with its build assets. A new worker
        // replaces them together; a new deployment must not mix cache versions.
        if (url.pathname === '/local' && response.status === 404) {
          await caches.delete(CACHE);
          await self.registration.unregister();
        }
        if (response.status >= 500) throw new Error('Server unavailable');
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE);
        const shell = await cache.match('/local');
        if (shell) return shell;
        throw error;
      } finally { clearTimeout(timer); }
    })());
    return;
  }
  if (STATIC.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(url.pathname) || fetch(request);
    })());
  }
  // APIs, OAuth, game links, RSC requests and external resources stay on network.
});
`;
}
