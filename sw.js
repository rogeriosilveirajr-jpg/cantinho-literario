// Service worker do Cantinho Literário.
// Estratégia "rede primeiro": sempre busca a versão nova do site e só usa a cópia
// guardada quando a pessoa está sem internet. Assim as atualizações chegam a todos.
const CACHE_NAME = 'cantinho-cache-v3';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './db.js', './auth.js', './firebase-config.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Só cuida dos arquivos do próprio site; Firebase, fontes e APIs passam direto.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
  );
});
