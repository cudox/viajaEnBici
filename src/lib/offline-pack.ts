import { CACHE } from '../config';

export interface EstadoPaquete {
  soportado: boolean;
  archivos: number;
  total: number;
  completo: boolean;
  bytes?: number;
}

export interface ProgresoPaquete {
  hechos: number;
  total: number;
  archivo: string;
}

function urlAbsoluta(ruta: string): string {
  return new URL(ruta, document.baseURI).href;
}

export function cacheDisponible(): boolean {
  return typeof caches !== 'undefined';
}

export async function verificarPaqueteOffline(): Promise<EstadoPaquete> {
  if (!cacheDisponible()) {
    return { soportado: false, archivos: 0, total: CACHE.archivosOffline.length, completo: false };
  }
  const cache = await caches.open(CACHE.nombre);
  let archivos = 0;
  for (const ruta of CACHE.archivosOffline) {
    const respuesta = await cache.match(urlAbsoluta(ruta));
    if (respuesta) archivos++;
  }
  return {
    soportado: true,
    archivos,
    total: CACHE.archivosOffline.length,
    completo: archivos === CACHE.archivosOffline.length,
  };
}

async function cachearArmazonActual(cache: Cache): Promise<void> {
  const urls = new Set<string>([
    new URL('./', document.baseURI).href,
    new URL('index.html', document.baseURI).href,
  ]);
  document
    .querySelectorAll('script[src], link[rel="stylesheet"], link[rel="modulepreload"], link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((elemento) => {
      const valor = elemento.getAttribute('src') ?? elemento.getAttribute('href');
      if (!valor) return;
      try {
        const url = new URL(valor, document.baseURI);
        if (url.origin === location.origin) urls.add(url.href);
      } catch {
        // Ignorar URLs no válidas.
      }
    });

  for (const url of urls) {
    if (await cache.match(url)) continue;
    try {
      const respuesta = await fetch(url, { cache: 'reload' });
      if (respuesta.ok) await cache.put(url, respuesta.clone());
    } catch {
      // El service worker tiene su propia precarga; no bloquear por un recurso.
    }
  }
}

export async function prepararPaqueteOffline(
  alProgresar?: (progreso: ProgresoPaquete) => void,
): Promise<EstadoPaquete> {
  if (!cacheDisponible()) {
    throw new Error('Este navegador no ofrece Cache Storage. En Android los datos ya vienen incluidos en la app.');
  }
  const cache = await caches.open(CACHE.nombre);
  const total = CACHE.archivosOffline.length;
  let hechos = 0;

  // Primero el armazón: documento, JS/CSS con hash e iconos. Así una recarga
  // sin red no depende de que el service worker ya controlara la primera visita.
  await cachearArmazonActual(cache);

  for (const ruta of CACHE.archivosOffline) {
    const url = urlAbsoluta(ruta);
    const existente = await cache.match(url);
    if (!existente) {
      const respuesta = await fetch(url, { cache: 'reload' });
      if (!respuesta.ok) {
        throw new Error(`No se pudo guardar ${ruta} (HTTP ${respuesta.status}).`);
      }
      await cache.put(url, respuesta.clone());
    }
    hechos++;
    alProgresar?.({ hechos, total, archivo: ruta });
  }

  // El documento y los recursos con hash se cachean al navegar; aquí se
  // garantiza el armazón mínimo para abrir la app sin red.
  for (const ruta of ['./', 'index.html']) {
    const url = urlAbsoluta(ruta);
    if (!(await cache.match(url))) {
      try {
        const respuesta = await fetch(url, { cache: 'reload' });
        if (respuesta.ok) await cache.put(url, respuesta.clone());
      } catch {
        // No es crítico: el service worker tiene su propio precache.
      }
    }
  }

  return verificarPaqueteOffline();
}

export async function borrarPaqueteOffline(): Promise<void> {
  if (!cacheDisponible()) return;
  await caches.delete(CACHE.nombre);
}

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
