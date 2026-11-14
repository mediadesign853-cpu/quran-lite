/*
 * Service worker: after the first visit the whole app and the whole Quran work offline.
 *
 * The two constants below (the cache name and file list) are filled in by
 * scripts/precache-plugin.mjs at build time. All paths are relative to the scope of this
 * worker, i.e. to the app's BASE_URL.
 *
 *  - install:  downloads the app shell, all 114 surah files, surah list, search index, fonts and icons.
 *  - fetch:    serves files cache-first from the current application cache.
 *  - activate: deletes old caches only after the user accepts an update, then takes control.
 *  - updates wait for approval so old application code is never paired with a newly replaced cache.
 */
/* global __PRECACHE_URLS__ */
const PRECACHE = '__PRECACHE_NAME__';
const PRECACHE_URLS = __PRECACHE_URLS__;
const CACHE_PREFIX = 'quran-reader-';

const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;
const toUrl = (path) => new URL(path, SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // In batches, and 'reload' so that nothing stale comes from the browser's HTTP cache.
      // If one file fails the partial cache is deleted and installation is retried later.
      try {
        for (let i = 0; i < PRECACHE_URLS.length; i += 20) {
          const batch = PRECACHE_URLS.slice(i, i + 20).map((p) => new Request(toUrl(p), { cache: 'reload' }));
          await cache.addAll(batch);
        }
      } catch (error) {
        // A failed installation must not leave a partial cache that could be mistaken for a valid one.
        await caches.delete(PRECACHE);
        throw error;
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== PRECACHE).map((n) => caches.delete(n))
      );
      // older versions used other names (quran-reader-v1, ...): they start with the same prefix and are gone now
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  event.respondWith(respond(request));
});

async function respond(request) {
  // opening the app (any address inside it): serve the app shell
  // Look only in this worker's cache namespace. A newly installed but not yet approved
  // worker has a different cache; global caches.match() would expose its files too early.
  if (request.mode === 'navigate') {
    const appCache = await caches.open(PRECACHE);
    return (await appCache.match(toUrl('index.html'))) || fetch(request);
  }
  const appCache = await caches.open(PRECACHE);
  const appCached = await appCache.match(request, { ignoreSearch: true });
  if (appCached) return appCached;
  return fetch(request);
}
