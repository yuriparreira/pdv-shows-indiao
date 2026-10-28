// Service worker: guarda o app para abrir sem internet e as fotos dos produtos.
const APP = 'pdv-app-v22';
const FOTOS = 'cd777e3e02'; // versão das miniaturas (atualizada por fotos/gerar_miniaturas.py)
const ARQ = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon.svg',
  'marca/logo-negativo.svg', 'marca/logo-positivo.svg', 'marca/JockeyOne-Regular.ttf', 'marca/FamiljenGrotesk-VariableFont_wght.ttf',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'];
self.addEventListener('install', e => {
  // guarda o app e todas as miniaturas dos produtos: funcionam offline desde a instalação
  e.waitUntil(caches.open(APP).then(async c => {
    await Promise.all(ARQ.map(u => c.add(u).catch(() => null)));
    try { const ind = await (await fetch('fotos/indice.json', { cache: 'no-cache' })).json(); await c.put('fotos/indice.json', new Response(JSON.stringify(ind), { headers: { 'Content-Type': 'application/json' } }));
      await Promise.all([...new Set(Object.values(ind.skus || {}))].map(f => c.add('fotos/' + f).catch(() => null))); } catch (err) { }
  }).then(() => self.skipWaiting()));
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
  // sincronização e outros serviços externos passam direto (nunca vão para o cache)
  if (u.origin !== location.origin && u.hostname !== 'cdnjs.cloudflare.com') return;
  // app: rede primeiro, revalidando com o servidor (versão nova chega na primeira abertura com internet); offline usa o cache
  const req = r.mode === 'navigate' ? new Request(r.url, { cache: 'no-cache', credentials: 'same-origin' }) : (u.origin === location.origin ? new Request(r, { cache: 'no-cache' }) : r);
  e.respondWith(fetch(req).then(res => { if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(APP).then(c => c.put(r.url, cp)); } return res; })
    .catch(() => caches.match(r.url, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
