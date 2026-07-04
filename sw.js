// Generado automáticamente por build.js — no editar a mano
const CACHE_NAME = "th-cache-1783186694666";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./bundle-1783186694666.js",
  "./public/favicon.ico",
  "./public/logo192.png",
  "./public/logo512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        CORE_ASSETS.map((url) => cache.add(url).catch(() => {}))
      ))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Solo cachear el mismo origen (app shell). Las peticiones a Supabase
  // y otros servicios externos van directo a la red sin pasar por cache,
  // para no servir datos de inventario/ventas desactualizados.
  if (url.origin !== self.location.origin) return;

  // version.json y navegación: red primero (para detectar actualizaciones),
  // cache de respaldo si no hay internet.
  if (url.pathname.endsWith("version.json") || request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Resto de assets: cache primero (rápido y funciona offline),
  // y se actualiza el cache en segundo plano si hay red.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
