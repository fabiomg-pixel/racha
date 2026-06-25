// Racha — service worker (cache versionado). App único, duas abas.
// Online-first pro HTML; cacheia o shell + módulos locais. Supabase/CDN/Anthropic passam direto.
const CACHE = "racha-v12";
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
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    return res;
  }).catch(() => hit)));
});
