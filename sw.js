/* Hucha · service worker: la app funciona sin conexión */
var CACHE = 'hucha-v32';
var ARCHIVOS = [
  './', 'index.html', 'css/app.css?v=32', 'js/core.js?v=32', 'js/vault.js?v=32', 'js/icons.js?v=32', 'js/charts.js?v=32', 'js/app.js?v=32',
  'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Red primero (para recibir actualizaciones), caché si no hay conexión.
  // La página principal se pide siempre revalidando (sin la caché HTTP de 10 min de GitHub Pages),
  // así cada vez que abres la app ves la última versión publicada.
  var url = new URL(req.url), esPagina = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname) || /\.webmanifest$/.test(url.pathname);
  var peticion = esPagina ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req);
  e.respondWith(peticion.then(function (res) {
    var copia = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copia); });
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: false }).then(function (r) { return r || caches.match('index.html'); });
  }));
});
