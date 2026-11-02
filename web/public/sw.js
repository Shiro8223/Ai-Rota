// Rota Agent service worker: web push for shift changes/reminders, and a plain offline message
// for the staff app. Nothing personal is cached (phones are often shared), and rota data must be fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  e.respondWith(
    fetch(req).catch(
      () => new Response("<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:system-ui;padding:2rem;text-align:center'><h1>You're offline</h1><p>Your shifts will appear when you reconnect.</p>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Rota", body: "", url: "/me" };
  try {
    data = { ...data, ...e.data.json() };
  } catch {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon.svg", badge: "/icon.svg", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/me";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (new URL(c.url).pathname === new URL(url, self.location.origin).pathname && "focus" in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
