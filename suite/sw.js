/* =========================================================
   BESTA · suite — service worker del modo directo.
   Su único trabajo: que ensayos.html abra sin internet.
   Los datos (canciones y listas) no viven aquí, los guarda
   la propia página en localStorage al preparar el directo.
   ========================================================= */
const VERSION = "besta-suite-v1";
const SHELL = "shell-" + VERSION;
const RUNTIME = "runtime-" + VERSION;

/* Lo imprescindible para que el atril arranque en modo avión. */
const SHELL_URLS = [
  "/suite/ensayos.html",
  "/suite/suite.js",
  "/assets/images/besta_color.png",
  "/assets/images/besta.png",
  "/assets/favicons/favicon-32x32.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  "https://unpkg.com/svguitar@2.4.0/dist/svguitar.umd.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Una a una: si un CDN falla no queremos tirar la instalación entera.
    await Promise.all(SHELL_URLS.map(url =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== SHELL && k !== RUNTIME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* La página puede pedir que se rellene la caché al vuelo
   ("preparar directo") sin esperar a un install nuevo. */
self.addEventListener("message", event => {
  if (event.data?.type !== "PRIME_CACHE") return;
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map(url =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    event.source?.postMessage({ type: "PRIMED" });
  })());
});

const isFont = url =>
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Supabase nunca se cachea: o hay red y son datos frescos, o no hay
  // y la página tira de su copia local. Una respuesta vieja aquí mentiría.
  if (url.hostname.endsWith(".supabase.co")) return;

  // Documentos: primero la red (para no servir una versión vieja de la app),
  // y si no hay, lo cacheado.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match(req)) ||
               (await caches.match("/suite/ensayos.html")) ||
               Response.error();
      }
    })());
    return;
  }

  // Scripts, imágenes y tipografías: lo cacheado manda, y si no está se
  // busca y se guarda para la próxima.
  if (["script", "image", "style", "font"].includes(req.destination) || isFont(url)) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        return hit || Response.error();
      }
    })());
  }
});
