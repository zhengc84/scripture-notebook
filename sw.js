// Service worker: keeps the app's own files (and its fonts) on the device so it opens without internet.
// Files are served from the cache straight away and refreshed in the background, so an update
// published to the site shows up on the next launch. Bible API requests are not handled here;
// the app stores chapter text itself (see js/sources.js).
const CACHE = 'scripture-notebook-v1';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icon.svg',
  'js/books.js', 'js/sources.js', 'js/store.js', 'js/ink.js', 'js/app.js',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && !FONT_HOSTS.includes(url.hostname)) return;
  e.respondWith(staleWhileRevalidate(e));
});

async function staleWhileRevalidate(e) {
  const req = e.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then(res => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    e.waitUntil(network);
    return cached;
  }
  const res = await network;
  if (res) return res;
  if (req.mode === 'navigate') {
    const page = await cache.match('index.html');
    if (page) return page;
  }
  return Response.error();
}
