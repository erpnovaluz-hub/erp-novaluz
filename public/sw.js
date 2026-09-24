// =============================================================================
// Service worker do ERP Novaluz (PWA)
// - Páginas: sempre da rede (dados ao vivo e por usuário); sem rede → /offline
// - /_next/static: cache-first (arquivos com hash, nunca mudam)
// - ícones/logo/fotos em /public: stale-while-revalidate
// - NUNCA guarda /api, Supabase (outra origem) nem nada que não seja GET
// Troque VERSAO para forçar a atualização do cache em todos os aparelhos.
// =============================================================================
const VERSAO = "novaluz-v1";
const ESTATICO = `${VERSAO}-estatico`;
const MIDIA = `${VERSAO}-midia`;
const PRECACHE = ["/offline", "/icon-192.png", "/icon-512.png", "/logo-novaluz.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(ESTATICO).then((c) => c.addAll(PRECACHE)));
  // não chama skipWaiting aqui: o app mostra "Nova versão — atualizar" e o usuário decide
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => !n.startsWith(VERSAO)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase etc.: direto na rede
  if (url.pathname.startsWith("/api/")) return;

  // navegação: rede primeiro; offline → página de aviso
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }

  // assets do Next com hash: cache primeiro
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(ESTATICO).then((c) => c.put(req, copia)); }
        return res;
      })),
    );
    return;
  }

  // imagens públicas: devolve o que tem e atualiza por trás
  if (/\.(png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(MIDIA).then((c) => c.match(req).then((hit) => {
        const rede = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || rede;
      })),
    );
  }
});
