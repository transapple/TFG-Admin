/* TFG Admin service worker
   - Required by Chrome/Edge/Samsung Internet before they allow a real install.
   - Keeps a copy of the app AND the Supabase library so it still opens with no signal
     (needed so songs can be saved to Drafts while offline). */

const CACHE_PREFIX = "tfg-admin-";
const CACHE = CACHE_PREFIX + "v2";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
// The only cross-site file we keep: the Supabase library the app needs to start.
const SUPABASE_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled([
        ...SHELL.map((u) => cache.add(new Request(u, { cache: "reload" }))),
        // Fetched with CORS (jsDelivr allows it) so we can check the reply is really OK
        // before keeping it; a bad/blocked reply is never stored.
        fetch(SUPABASE_LIB).then((res) => { if (!res.ok) throw new Error("bad"); return cache.put(SUPABASE_LIB, res); })
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // Only touch our own caches; other sites on the same host share Cache Storage.
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Supabase library: cached copy first (works offline), refreshed quietly in the background.
  // Only a verified OK reply is ever stored, so a failed download can't replace a good copy.
  if (req.url === SUPABASE_LIB) {
    const refresh = () => fetch(SUPABASE_LIB).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SUPABASE_LIB, copy)).catch(() => {}); }
      return res;
    });
    event.respondWith(
      caches.match(SUPABASE_LIB).then((cached) => {
        if (cached) { event.waitUntil(refresh().catch(() => {})); return cached; }
        return refresh().catch(() => fetch(req));
      })
    );
    return;
  }

  // Database calls, other CDNs, fonts, etc. go straight to the network, never cached here.
  if (url.origin !== self.location.origin) return;

  // Opening the app: network first (always the latest version), cached copy if offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Icons, manifest and other same-site files: cached copy first, refreshed in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
