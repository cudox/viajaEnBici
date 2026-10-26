export type LatLng = [number, number];

export type PerfilRuta = 'rapida' | 'corta' | 'segura';
export type ProveedorRuta = 'valhalla' | 'brouter' | 'mapas' | 'offline';

export interface Lugar {
  etiqueta: string;
  lat: number;
  lon: number;
}

export interface PasoRuta {
  instruccion: string;
  distanciaM: number;
  duracionS: number;
  calle?: string;
}

export interface RutaBici {
  id: string;
  perfil: PerfilRuta | null;
  proveedor: ProveedorRuta;
  proveedorEtiqueta: string;
  perfilMotor?: string;
  distanciaM: number;
  duracionS: number;
  ascensoM?: number;
  geometria: LatLng[];
  pasos: PasoRuta[];
  advertencias?: string[];
  resumen?: string;
  /** Puntuación relativa de estrés (menor = más segura). Solo motor offline. */
  seguridad?: number;
}

export interface EstadoFuente {
  nombre: string;
  ok: boolean;
  detalle: string;
}

export interface ConjuntoRutas {
  rapida: RutaBici;
  corta: RutaBici;
  segura: RutaBici;
  alternativas: RutaBici[];
  generado: string;
  avisos: string[];
  fuentes: EstadoFuente[];
  offline: boolean;
}

export interface Preferencias {
  tema: 'claro' | 'oscuro';
  modoOffline: 'auto' | 'siempre' | 'nunca';
  mostrarCiclorrutas: boolean;
  mapaVectorial: boolean;
  ultimoPerfil: PerfilRuta;
  origen?: Lugar;
  destino?: Lugar;
}

export interface OpcionesRuta {
  origen: Lugar;
  destino: Lugar;
  signal?: AbortSignal;
  usarOffline?: boolean;
}

export interface GrafoNodo {
  lat: number;
  lon: number;
}

export interface GrafoDatos {
  version: number;
  generado: string;
  fuente: string;
  bbox: [number, number, number, number];
  clases: Array<{ id: string; v: number; s: number }>;
  nombres: string[];
  /** [lat, lon] */
  nodos: Array<[number, number]>;
  /** [a, b, longitudM, clase, nombre, sentidos, velocidadKmh, seguridad] */
  aristas: Array<[number, number, number, number, number, number, number, number]>;
}

export interface ResultadoOffline {
  ruta: RutaBici;
  nodos: number;
}
