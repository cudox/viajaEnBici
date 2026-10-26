import type { Lugar, PerfilRuta, Preferencias, RutaBici } from '../types';

const CLAVE_PREF = 'veb.prefs.v1';
const CLAVE_SESION = 'veb.sesion.v1';
const CLAVE_ULTIMA = 'veb.ultimaRuta.v1';

export const PREFERENCIAS_INICIALES: Preferencias = {
  tema: 'claro',
  modoOffline: 'auto',
  mostrarCiclorrutas: true,
  mapaVectorial: false,
  ultimoPerfil: 'rapida',
};

function leerJson<T>(clave: string): T | null {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? (JSON.parse(crudo) as T) : null;
  } catch {
    return null;
  }
}

function escribirJson(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento (modo privado o cuota llena): la app sigue funcionando.
  }
}

export function cargarPreferencias(): Preferencias {
  const guardadas = leerJson<Partial<Preferencias>>(CLAVE_PREF);
  const prefs = { ...PREFERENCIAS_INICIALES, ...(guardadas ?? {}) };
  if (prefs.tema !== 'claro' && prefs.tema !== 'oscuro') prefs.tema = 'claro';
  if (!['auto', 'siempre', 'nunca'].includes(prefs.modoOffline)) prefs.modoOffline = 'auto';
  if (!['rapida', 'corta', 'segura'].includes(prefs.ultimoPerfil)) prefs.ultimoPerfil = 'rapida';
  return prefs;
}

export function guardarPreferencias(prefs: Preferencias): void {
  escribirJson(CLAVE_PREF, prefs);
}

export interface Sesion {
  origen?: Lugar;
  destino?: Lugar;
  perfil?: PerfilRuta;
}

export function cargarSesion(): Sesion {
  return leerJson<Sesion>(CLAVE_SESION) ?? {};
}

export function guardarSesion(sesion: Sesion): void {
  escribirJson(CLAVE_SESION, sesion);
}

export function guardarUltimaRuta(ruta: RutaBici, origen: Lugar, destino: Lugar): void {
  escribirJson(CLAVE_ULTIMA, {
    guardada: new Date().toISOString(),
    origen,
    destino,
    ruta: {
      id: ruta.id,
      perfil: ruta.perfil,
      proveedor: ruta.proveedor,
      distanciaM: ruta.distanciaM,
      duracionS: ruta.duracionS,
      pasos: ruta.pasos,
      geometria: ruta.geometria,
    },
  });
}

export function cargarUltimaRuta(): {
  guardada: string;
  origen: Lugar;
  destino: Lugar;
  ruta: Partial<RutaBici>;
} | null {
  return leerJson(CLAVE_ULTIMA);
}

export function borrarDatosLocales(): void {
  for (const clave of [CLAVE_PREF, CLAVE_SESION, CLAVE_ULTIMA]) {
    try {
      localStorage.removeItem(clave);
    } catch {
      // Ignorar.
    }
  }
}
