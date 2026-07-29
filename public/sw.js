// Service worker mínimo — não faz cache nem nada sofisticado, só existe
// para o navegador reconhecer o Mirante como instalável (ícone próprio +
// tela cheia ao adicionar à tela inicial).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Deixa o navegador buscar normalmente — não interceptamos nada.
});
