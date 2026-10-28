// Service worker: guarda o app para abrir sem internet e as fotos dos produtos.
const APP = 'pdv-app-v2';
const ARQ = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon.svg',
  'marca/logo-negativo.svg', 'marca/logo-positivo.svg', 'marca/JockeyOne-Regular.ttf', 'marca/FamiljenGrotesk-VariableFont_wght.ttf',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => Promise.all(ARQ.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pdv-app-') && k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // fotos: cache primeiro (guardadas pelo botão "Guardar fotos" ou na primeira vez que aparecem)
  if (r.destination === 'image' && u.origin !== location.origin) {
    e.respondWith(caches.open('pdv-fotos').then(async c => {
      const hit = await c.match(r.url); if (hit) return hit;
      try { const res = await fetch(r.url, { mode: 'no-cors' }); c.put(r.url, res.clone()); return res; } catch (err) { return Response.error(); }
    }));
    return;
  }
  // app: rede primeiro (pega atualização), cache se estiver offline
  e.respondWith(fetch(r).then(res => { if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(APP).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
