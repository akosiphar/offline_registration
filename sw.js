const CACHE = "offline-form-v1";
const APP_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/manifest.webmanifest",
  // add '/icons/icon-192.png', '/icons/icon-512.png' when you add icons
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

// Cache-first for navigations and static assets
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests for caching strategy
  if (req.method === "GET" && url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
              return res;
            })
            .catch(() => caches.match("/index.html"))
      )
    );
  }
});

// Background Sync: ask the page to sync when we regain connectivity
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-submissions") {
    event.waitUntil(
      self.clients
        .matchAll({ includeUncontrolled: true, type: "window" })
        .then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "DO_SYNC" }));
        })
    );
  }
});
