import type { Lugar, ModoOrigen, PerfilRuta, Preferencias } from '../types';
import { CLAVE_DESTINOS, CLAVE_FAVORITAS } from './rutas-guardadas';

const CLAVE_PREF = 'veb.prefs.v1';
const CLAVE_SESION = 'veb.sesion.v1';
const CLAVE_ULTIMA_LEGADO = 'veb.ultimaRuta.v1';

export const PREFERENCIAS_INICIALES: Preferencias = {
  tema: 'claro',
  modoOffline: 'auto',
  mostrarCiclorrutas: true,
  mapaVectorial: false,
  ultimoPerfil: 'rapida',
  guardarRecientes: true,
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
  prefs.guardarRecientes = prefs.guardarRecientes !== false;
  return prefs;
}

export function guardarPreferencias(prefs: Preferencias): void {
  escribirJson(CLAVE_PREF, prefs);
}

export interface Sesion {
  origen?: Lugar;
  destino?: Lugar;
  origenModo?: ModoOrigen;
  perfil?: PerfilRuta;
}

export function cargarSesion(): Sesion {
  const sesion = leerJson<Sesion>(CLAVE_SESION) ?? {};
  if (sesion.origenModo !== 'actual' && sesion.origenModo !== 'manual') {
    sesion.origenModo = sesion.origen ? 'manual' : 'actual';
  }
  // Un modo manual sin coordenadas dejaría el origen vacío y sin GPS.
  if (sesion.origenModo === 'manual' && !sesion.origen) sesion.origenModo = 'actual';
  return sesion;
}

export function guardarSesion(sesion: Sesion): void {
  escribirJson(CLAVE_SESION, sesion);
}

export function borrarDatosLocales(): void {
  for (const clave of [
    CLAVE_PREF,
    CLAVE_SESION,
    CLAVE_ULTIMA_LEGADO,
    CLAVE_DESTINOS,
    CLAVE_FAVORITAS,
  ]) {
    try {
      localStorage.removeItem(clave);
    } catch {
      // Ignorar.
    }
  }
}
