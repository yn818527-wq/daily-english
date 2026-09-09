/* 每日五词 Service Worker
 * 应用外壳：缓存优先；词库数据：网络优先（保证每天的新词能更新到）
 */
var CACHE = 'd5-cache-v5';
var SHELL = [
  './',
  './index.html',
  './assets/style.css',
  './assets/app.js',
  './vendor/qrcode.min.js',
  './vendor/jsQR.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).then(function () {
        // 预缓存全部发音音频，保证离线也能听
        return fetch('./words.json?t=' + Date.now())
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var urls = (d.words || []).map(function (w) { return './' + w.audio; })
              .filter(function (u) { return u && u.indexOf('undefined') < 0; });
            return c.addAll(urls);
          })
          .catch(function () { });
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  if (e.request.method !== 'GET') return;

  // 词库数据：网络优先，失败回退缓存
  if (url.indexOf('words.json') >= 0 || url.indexOf('words.js') >= 0) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(e.request);
      })
    );
    return;
  }

  // 其他资源：缓存优先，后台更新
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var fetching = fetch(e.request).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fetching;
    })
  );
});
