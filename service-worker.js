/**
 * Service worker: offline shell for the workout timer PWA.
 *
 * Strategy: cache-first for same-origin GET requests.
 * - On install, precache core static assets (HTML, CSS, JS, manifest, icons).
 * - On fetch: return cached copy if present; otherwise try network.
 * - Navigation to "/" may not match cached "index.html" by URL, so we fall back
 *   to the cached index document for HTML navigations.
 *
 * Bump CACHE_NAME when you change precached files so clients pick up updates.
 */
const CACHE_NAME = "workout-timer-pwa-v7";

/** Paths relative to the service worker scope (usually site root). */
const PRECACHE_URLS = [
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

function resolveUrl(relativePath) {
  return new URL(relativePath, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((p) => resolveUrl(p))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return undefined;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // HTML navigations often request "/" while we cached "/index.html".
      if (request.mode === "navigate") {
        return caches.match(resolveUrl("./index.html")).then((navFallback) => {
          if (navFallback) return navFallback;
          return fetch(request);
        });
      }

      return fetch(request).then((networkResponse) => {
        // Optional: could cache successful same-origin GETs here for future visits.
        return networkResponse;
      });
    })
  );
});
