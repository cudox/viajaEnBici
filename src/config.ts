export const APP = {
  nombre: 'Viaja en Bici',
  descripcion: 'Rutas ciclistas seguras para Bogotá',
  version: '0.1.0',
  idAndroid: 'co.viajaenbici.app',
  repositorio: 'https://github.com/cudox/viajaEnBici',
} as const;

/** Centro y límites del área metropolitana que cubre el MVP. */
export const BOGOTA = {
  centro: [4.6486, -74.0628] as [number, number],
  zoom: 12,
  limites: [
    [4.45, -74.25],
    [4.85, -73.95],
  ] as [[number, number], [number, number]],
};

export const CAPAS = {
  // Mapa Base del Mapa de Referencia de Bogotá (IDECA / Catastro Distrital).
  // Servicio público sin clave, con teselas para todos los niveles de zoom.
  claro:
    'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/mapa_base_3857/MapServer/tile/{z}/{y}/{x}',
  oscuro:
    'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/mapa_base_oscuro_3857/MapServer/tile/{z}/{y}/{x}',
  atribucion:
    '&copy; IDECA · Catastro Bogotá · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

export const DATOS = {
  ciclorrutas: 'data/ciclorrutas.geojson',
  ciclorrutasMeta: 'data/ciclorrutas.meta.json',
  base: 'data/base-bogota.geojson',
  grafo: 'data/grafo-bogota.json.gz.bin',
  grafoMeta: 'data/grafo-bogota.meta.json',
};

export const ENRUTAMIENTO = {
  valhalla: 'https://valhalla1.openstreetmap.de/route',
  brouter: 'https://brouter.de/brouter',
  mapasBogota: 'https://catalogopmb.catastrobogota.gov.co/PMBWeb/web/ruteo',
  nominatim: 'https://nominatim.openstreetmap.org',
  tiempoMaximoMs: 25_000,
  cacheMs: 5 * 60_000,
};

export const CACHE = {
  nombre: 'viajaenbici-v3',
  archivosOffline: [
    DATOS.ciclorrutas,
    DATOS.ciclorrutasMeta,
    DATOS.base,
    DATOS.grafo,
    DATOS.grafoMeta,
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
  ],
};

export const COLORES = {
  rapida: '#f59e0b',
  corta: '#3b82f6',
  segura: '#16a34a',
  offline: '#8b5cf6',
};

export const VELOCIDAD_CICLISTA_KMH = 16;
