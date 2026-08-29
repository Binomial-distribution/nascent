self.addEventListener("install", (event) => {
  self.skipWaiting();
  // 缓存名带版本号：模块拆分后，沿用旧缓存会让客户端缺文件、import 404。
  event.waitUntil(caches.open("nascent-shell-v22").then((cache) => cache.addAll([
    "/",
    "/css/app.css",
    "/js/app.js",
    "/js/ble.js",
    "/js/body-notes.js",
    "/js/channel.js",
    "/js/governor.js",
    "/js/heart.js",
    "/js/hr.js",
    "/js/lab.js",
    "/js/live-call.js",
    "/js/onboarding.js",
    "/js/persona-cards.js",
    "/js/routes.js",
    "/js/scenario-session.js",
    "/js/session.js",
    "/js/protocol.js",
    "/js/transport.js",
    "/js/ws.js",
    "/manifest.webmanifest",
  ])));
});

self.addEventListener("activate", (event) => {
  // 顺手删掉旧版本的缓存，否则旧版本会一直占着空间且永远不会被用到。
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith("nascent-shell-") && n !== "nascent-shell-v22")
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/v1/") || url.pathname === "/docs" || url.pathname === "/healthz" || url.pathname === "/redoc") {
    return;
  }
  // 开发预览优先走网络，避免旧脚本卡在缓存里。
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open("nascent-shell-v22").then((cache) => cache.put(event.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});
