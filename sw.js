// Service worker simples: guarda em cache os arquivos do app para abrir
// mais rápido e funcionar offline. Os dados (listas/tarefas) continuam
// vivendo no IndexedDB, como sempre — isto aqui só cuida dos arquivos do
// próprio app (HTML/CSS/JS/ícones).
const CACHE_NAME = "checklist-app-v1";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./src/main.js",
  "./src/App.js",
  "./src/htm.js",
  "./src/lib/db.js",
  "./src/lib/format.js",
  "./src/lib/image.js",
  "./src/lib/auth.js",
  "./src/lib/sync.js",
  "./src/lib/tasks.js",
  "./src/hooks/useSync.js",
  "./src/context/UiContext.js",
  "./src/components/Icons.js",
  "./src/components/TaskImage.js",
  "./src/components/LoginScreen.js",
  "./src/components/Topbar.js",
  "./src/components/MenuView.js",
  "./src/components/CreateView.js",
  "./src/components/ResolveSelectView.js",
  "./src/components/ResolveTaskView.js",
  "./src/components/ListDetailView.js",
  "./src/components/SettingsView.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia: tenta a rede primeiro (para pegar atualizações do app), e
// só usa o cache se estiver offline. Não intercepta chamadas para fora do
// próprio site (Google Apps Script, unpkg, esm.sh) — essas seguem direto.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
