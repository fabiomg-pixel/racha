// Racha — service worker (cache versionado). App único, duas abas.
// NETWORK-FIRST: online sempre serve o código fresco; o cache é só fallback offline (aba Racha).
// Supabase/CDN/Anthropic passam direto pra rede.
const CACHE = "racha-v18";
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./icon.svg",
  "./js/app.js", "./js/db.js", "./js/ocr.js",
  "./js/split.js", "./js/ledger.js", "./js/pix.js", "./js/parse.js", "./js/money.js",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                  // nunca cacheia POST (OCR/RPC/auth)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // Supabase / esm.sh / Anthropic passam direto pra rede
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }
  // network-first: pega o JS/asset fresco quando online; cai pro cache só se a rede falhar
  e.respondWith(fetch(req).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    return res;
  }).catch(() => caches.match(req)));
});
