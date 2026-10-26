/* Service worker de viajaEnBici.
 * Estrategia: armazón de la app y datos locales con cache-first / SWR.
 * Las teselas externas no se almacenan masivamente; el modo sin conexión usa
 * el mapa base vectorial incluido en la aplicación.
 */
const VERSION = 'viajaenbici-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/**
 * Guarda el documento y los recursos con hash que referencia. Así una recarga
 * completa funciona sin red incluso si el usuario nunca visitó la app dos veces.
 */
async function cachearArmazon() {
  const cache = await caches.open(VERSION);
  const base = self.location.href;
  const indexUrl = new URL('./index.html', base).href;
  const raizUrl = new URL('./', base).href;
  const recursos = new Set(SHELL.map((ruta) => new URL(ruta, base).href));

  try {
    const respuesta = await fetch(indexUrl, { cache: 'reload' });
    if (respuesta.ok) {
      const html = await respuesta.clone().text();
      await cache.put(indexUrl, respuesta.clone());
      await cache.put(raizUrl, respuesta.clone());
      for (const coincidencia of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
        try {
          const url = new URL(coincidencia[1], indexUrl);
          if (url.origin === self.location.origin) recursos.add(url.href);
        } catch {
          // Ignorar URLs no válidas del HTML.
        }
      }
    }
  } catch {
    // Sin red durante la instalación: se conserva lo que ya esté en caché.
  }

  for (const url of recursos) {
    if (url === indexUrl || url === raizUrl) continue;
    try {
      if (await cache.match(url)) continue;
      const respuesta = await fetch(url);
      if (respuesta.ok) await cache.put(url, respuesta);
    } catch {
      // Un recurso secundario no debe impedir la instalación del SW.
    }
  }
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(cachearArmazon().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

async function redPrimero(peticion) {
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) {
      const cache = await caches.open(VERSION);
      cache.put(peticion, respuesta.clone()).catch(() => undefined);
    }
    return respuesta;
  } catch {
    const cache = await caches.open(VERSION);
    return (
      (await cache.match(peticion)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      new Response('Sin conexión y sin copia local de la aplicación.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function cachePrimero(peticion) {
  const cache = await caches.open(VERSION);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) cache.put(peticion, respuesta.clone()).catch(() => undefined);
  return respuesta;
}

async function revalidarEnSegundoPlano(peticion) {
  const cache = await caches.open(VERSION);
  const guardada = await cache.match(peticion);
  const red = fetch(peticion)
    .then((respuesta) => {
      if (respuesta.ok) cache.put(peticion, respuesta.clone()).catch(() => undefined);
      return respuesta;
    })
    .catch(() => null);
  return guardada || (await red) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Teselas y APIs: red directa.

  if (request.mode === 'navigate') {
    evento.respondWith(redPrimero(request));
    return;
  }
  if (url.pathname.includes('/data/')) {
    evento.respondWith(revalidarEnSegundoPlano(request));
    return;
  }
  evento.respondWith(cachePrimero(request));
});

self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'CACHE_OFFLINE' && Array.isArray(evento.data.archivos)) {
    evento.waitUntil(
      caches.open(VERSION).then(async (cache) => {
        for (const archivo of evento.data.archivos) {
          const url = new URL(archivo, self.location.href).href;
          if (await cache.match(url)) continue;
          try {
            const respuesta = await fetch(url);
            if (respuesta.ok) await cache.put(url, respuesta);
          } catch {
            // Continuar con el resto.
          }
        }
      }),
    );
  }
});
