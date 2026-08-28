self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open("nascent-shell-v1").then((cache) => cache.addAll([
    "/",
    "/css/app.css",
    "/js/app.js",
    "/js/ble.js",
    "/js/governor.js",
    "/js/heart.js",
    "/js/session.js",
    "/js/protocol.js",
    "/manifest.webmanifest",
  ])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/v1/") || url.pathname === "/docs" || url.pathname === "/healthz" || url.pathname === "/redoc") {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});
