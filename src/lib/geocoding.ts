import { ENRUTAMIENTO } from '../config';
import type { Lugar } from '../types';
import { ErrorServicio, pedirJson } from './http';
import { normalizarTexto } from './format';

interface ResultadoNominatim {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  address?: Record<string, string>;
}

const cache = new Map<string, Lugar[]>();
const cacheInverso = new Map<string, string>();
let ultimaPeticion = 0;
let cola: Promise<unknown> = Promise.resolve();

function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(fn, fn);
  cola = siguiente.catch(() => undefined);
  return siguiente;
}

/** Nominatim pide como máximo una petición por segundo. */
async function esperarTurno(): Promise<void> {
  const ahora = Date.now();
  const espera = Math.max(0, 1100 - (ahora - ultimaPeticion));
  if (espera) await new Promise((r) => setTimeout(r, espera));
  ultimaPeticion = Date.now();
}

function etiquetaCorta(resultado: ResultadoNominatim): string {
  const partes = (resultado.display_name ?? '').split(',').map((p) => p.trim());
  const nombre = resultado.name?.trim();
  if (nombre && partes[0] !== nombre) return `${nombre} · ${partes.slice(0, 2).join(', ')}`;
  return partes.slice(0, 3).join(', ') || nombre || 'Lugar';
}

function convertir(resultado: ResultadoNominatim): Lugar {
  return {
    etiqueta: etiquetaCorta(resultado),
    lat: Number(resultado.lat),
    lon: Number(resultado.lon),
  };
}

export async function buscarLugares(consulta: string, signal?: AbortSignal): Promise<Lugar[]> {
  const limpia = consulta.trim();
  if (limpia.length < 3) return [];
  const clave = normalizarTexto(limpia);
  const guardado = cache.get(clave);
  if (guardado) return guardado;

  const params = new URLSearchParams({
    q: limpia,
    format: 'jsonv2',
    limit: '6',
    countrycodes: 'co',
    viewbox: '-74.25,4.45,-73.95,4.85',
    bounded: '1',
    'accept-language': 'es',
    addressdetails: '1',
  });

  return enCola(async () => {
    await esperarTurno();
    const resultados = await pedirJson<ResultadoNominatim[]>(
      `${ENRUTAMIENTO.nominatim}/search?${params}`,
      { signal, tiempoMaximoMs: 20_000 },
    );
    const lugares = resultados
      .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)))
      .map(convertir);
    if (cache.size > 100) cache.delete(cache.keys().next().value as string);
    cache.set(clave, lugares);
    return lugares;
  });
}

export async function describirPunto(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  const clave = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const guardado = cacheInverso.get(clave);
  if (guardado) return guardado;

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    zoom: '18',
    'accept-language': 'es',
  });

  return enCola(async () => {
    await esperarTurno();
    try {
      const resultado = await pedirJson<ResultadoNominatim>(
        `${ENRUTAMIENTO.nominatim}/reverse?${params}`,
        { signal, tiempoMaximoMs: 20_000 },
      );
      const etiqueta = etiquetaCorta(resultado);
      if (cacheInverso.size > 80) cacheInverso.delete(cacheInverso.keys().next().value as string);
      cacheInverso.set(clave, etiqueta);
      return etiqueta;
    } catch (error) {
      if (error instanceof ErrorServicio) return `Punto en el mapa (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
      throw error;
    }
  });
}

export async function obtenerUbicacion(): Promise<Lugar> {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    const permisos = await Geolocation.requestPermissions();
    if (permisos.location !== 'granted') {
      throw new Error('No hay permiso de ubicación. Actívalo en los ajustes de Android.');
    }
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15_000 });
    return {
      etiqueta: 'Mi ubicación',
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
    };
  }

  if (!navigator.geolocation) {
    throw new Error('Este navegador no ofrece geolocalización.');
  }
  return new Promise((resolver, rechazar) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolver({
          etiqueta: 'Mi ubicación',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        }),
      (error) => {
        const mensajes: Record<number, string> = {
          1: 'Permiso de ubicación denegado.',
          2: 'La ubicación no está disponible.',
          3: 'Se agotó el tiempo para obtener la ubicación.',
        };
        rechazar(new Error(mensajes[error.code] ?? 'No se pudo obtener la ubicación.'));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}
