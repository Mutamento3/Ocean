const CACHE_NAME = "ocean-shell-v29";
const APP_ROOT = new URL("./", self.registration.scope).pathname;
const SHELL = [APP_ROOT, `${APP_ROOT}manifest.webmanifest`, `${APP_ROOT}assets/brand/ocean-icon-192.png`, `${APP_ROOT}assets/brand/ocean-icon-512.png`];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_ROOT)) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT, copy));
      }
      return response;
    }).catch(() => caches.match(APP_ROOT)).then((response) => response || Response.error()));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) { const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); }
    return response;
  })));
});
self.addEventListener("push", (event) => {
  let payload = { title: "Ocean", body: "Ocean 有一条新消息。", tag: "ocean-message", url: "?room=living", room: "living" };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch { /* Keep the privacy-safe fallback. */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: `${APP_ROOT}assets/brand/ocean-icon-192.png`,
    badge: `${APP_ROOT}assets/brand/ocean-icon-192.png`,
    data: { url: payload.url, room: payload.room },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const room = event.notification.data?.room || "living";
  const target = new URL(event.notification.data?.url || `?room=${room}`, self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const client = windows[0];
    if (client) {
      client.postMessage({ type: "ocean:navigate", room });
      return client.focus();
    }
    return self.clients.openWindow(target);
  }));
});
