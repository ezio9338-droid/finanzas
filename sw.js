/* Hucha · service worker: la app funciona sin conexión */
var CACHE = 'hucha-v15';
var ARCHIVOS = [
  './', 'index.html', 'css/app.css?v=15', 'js/core.js?v=15', 'js/vault.js?v=15', 'js/icons.js?v=15', 'js/charts.js?v=15', 'js/app.js?v=15',
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
  e.respondWith(fetch(req).then(function (res) {
    var copia = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copia); });
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: false }).then(function (r) { return r || caches.match('index.html'); });
  }));
});
