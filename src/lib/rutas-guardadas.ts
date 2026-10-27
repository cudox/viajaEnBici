import type { DestinoReciente, Lugar, PerfilRuta, RutaFavorita } from '../types';

export const CLAVE_DESTINOS = 'veb.destinos.v1';
export const CLAVE_FAVORITAS = 'veb.favoritas.v1';
export const MAX_DESTINOS = 30;
export const MAX_FAVORITAS = 100;

/** Lo mínimo de Storage que necesita el módulo; permite usar memoria en pruebas. */
export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

export interface ResumenRutasGuardadas {
  destinos: number;
  favoritas: number;
}

export interface OpcionesFavorita {
  nombre?: string;
  perfil?: PerfilRuta;
  distanciaM?: number;
  duracionS?: number;
}

const PERFILES: PerfilRuta[] = ['rapida', 'corta', 'segura'];

function almacenPredeterminado(): Almacen | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function claveLugar(lugar: Lugar): string {
  return `${lugar.lat.toFixed(5)},${lugar.lon.toFixed(5)}`;
}

export function idDestino(lugar: Lugar): string {
  return `destino:${claveLugar(lugar)}`;
}

export function idFavorita(origen: Lugar, destino: Lugar): string {
  return `favorita:${claveLugar(origen)}>${claveLugar(destino)}`;
}

export function esLugar(valor: unknown): valor is Lugar {
  if (!valor || typeof valor !== 'object') return false;
  const lugar = valor as Partial<Lugar>;
  return (
    typeof lugar.etiqueta === 'string' &&
    lugar.etiqueta.trim().length > 0 &&
    typeof lugar.lat === 'number' &&
    Number.isFinite(lugar.lat) &&
    lugar.lat >= -90 &&
    lugar.lat <= 90 &&
    typeof lugar.lon === 'number' &&
    Number.isFinite(lugar.lon) &&
    lugar.lon >= -180 &&
    lugar.lon <= 180
  );
}

function esDestino(valor: unknown): valor is DestinoReciente {
  if (!valor || typeof valor !== 'object') return false;
  const destino = valor as Partial<DestinoReciente>;
  return (
    typeof destino.id === 'string' &&
    esLugar(destino.destino) &&
    typeof destino.ultimaVez === 'string' &&
    !Number.isNaN(Date.parse(destino.ultimaVez)) &&
    typeof destino.veces === 'number' &&
    Number.isInteger(destino.veces) &&
    destino.veces > 0
  );
}

function esFavorita(valor: unknown): valor is RutaFavorita {
  if (!valor || typeof valor !== 'object') return false;
  const favorita = valor as Partial<RutaFavorita>;
  return (
    typeof favorita.id === 'string' &&
    typeof favorita.nombre === 'string' &&
    esLugar(favorita.origen) &&
    esLugar(favorita.destino) &&
    (favorita.perfil === undefined || PERFILES.includes(favorita.perfil)) &&
    (favorita.distanciaM === undefined ||
      (typeof favorita.distanciaM === 'number' && Number.isFinite(favorita.distanciaM))) &&
    (favorita.duracionS === undefined ||
      (typeof favorita.duracionS === 'number' && Number.isFinite(favorita.duracionS))) &&
    typeof favorita.creada === 'string' &&
    !Number.isNaN(Date.parse(favorita.creada)) &&
    typeof favorita.actualizada === 'string' &&
    !Number.isNaN(Date.parse(favorita.actualizada))
  );
}

function recortar(texto: string, maximo = 140): string {
  const limpio = texto.trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1)}…` : limpio;
}

function nombreFavorita(origen: Lugar, destino: Lugar): string {
  return recortar(`${origen.etiqueta} → ${destino.etiqueta}`, 120);
}

/**
 * Historial local de destinos y rutas favoritas.
 *
 * No guarda el origen de los destinos recientes: se resuelve con el GPS al
 * seleccionar uno. Solo las favoritas conservan un origen fijo.
 */
export class RutasGuardadas {
  private readonly memoria = new Map<string, string>();

  constructor(
    private readonly almacen: Almacen | null = almacenPredeterminado(),
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  private leer(clave: string): string | null {
    if (this.almacen) {
      try {
        const valor = this.almacen.getItem(clave);
        if (valor !== null) return valor;
      } catch {
        // Cuota, modo privado o almacenamiento bloqueado: usar memoria.
      }
    }
    return this.memoria.get(clave) ?? null;
  }

  private escribir(clave: string, valor: string): void {
    this.memoria.set(clave, valor);
    if (!this.almacen) return;
    try {
      this.almacen.setItem(clave, valor);
    } catch {
      // La app sigue funcionando durante esta sesión aunque no pueda persistir.
    }
  }

  private borrar(clave: string): void {
    this.memoria.delete(clave);
    if (!this.almacen) return;
    try {
      this.almacen.removeItem(clave);
    } catch {
      // Ignorar almacenamiento bloqueado.
    }
  }

  private leerLista<T>(clave: string, validador: (valor: unknown) => valor is T): T[] {
    const crudo = this.leer(clave);
    if (!crudo) return [];
    try {
      const datos = JSON.parse(crudo) as unknown;
      return Array.isArray(datos) ? datos.filter(validador) : [];
    } catch {
      return [];
    }
  }

  listarDestinos(): DestinoReciente[] {
    return this.leerLista(CLAVE_DESTINOS, esDestino);
  }

  registrarDestino(destino: Lugar): DestinoReciente[] {
    const id = idDestino(destino);
    const actuales = this.listarDestinos();
    const anterior = actuales.find((entrada) => entrada.id === id);
    const entrada: DestinoReciente = {
      id,
      destino: {
        etiqueta: recortar(destino.etiqueta),
        lat: destino.lat,
        lon: destino.lon,
      },
      ultimaVez: this.ahora().toISOString(),
      veces: (anterior?.veces ?? 0) + 1,
    };
    const lista = [entrada, ...actuales.filter((item) => item.id !== id)].slice(0, MAX_DESTINOS);
    this.escribir(CLAVE_DESTINOS, JSON.stringify(lista));
    return lista;
  }

  eliminarDestino(id: string): DestinoReciente[] {
    const lista = this.listarDestinos().filter((entrada) => entrada.id !== id);
    this.escribir(CLAVE_DESTINOS, JSON.stringify(lista));
    return lista;
  }

  limpiarDestinos(): void {
    this.borrar(CLAVE_DESTINOS);
  }

  listarFavoritas(): RutaFavorita[] {
    return this.leerLista(CLAVE_FAVORITAS, esFavorita);
  }

  guardarFavorita(
    origen: Lugar,
    destino: Lugar,
    opciones: OpcionesFavorita = {},
  ): RutaFavorita[] {
    const id = idFavorita(origen, destino);
    const actuales = this.listarFavoritas();
    const anterior = actuales.find((entrada) => entrada.id === id);
    const fecha = this.ahora().toISOString();
    const entrada: RutaFavorita = {
      id,
      nombre:
        (opciones.nombre?.trim() ? recortar(opciones.nombre, 120) : undefined) ??
        anterior?.nombre ??
        nombreFavorita(origen, destino),
      origen: {
        etiqueta: recortar(origen.etiqueta),
        lat: origen.lat,
        lon: origen.lon,
      },
      destino: {
        etiqueta: recortar(destino.etiqueta),
        lat: destino.lat,
        lon: destino.lon,
      },
      perfil: opciones.perfil ?? anterior?.perfil,
      distanciaM: opciones.distanciaM ?? anterior?.distanciaM,
      duracionS: opciones.duracionS ?? anterior?.duracionS,
      creada: anterior?.creada ?? fecha,
      actualizada: fecha,
    };
    const lista = [entrada, ...actuales.filter((item) => item.id !== id)].slice(0, MAX_FAVORITAS);
    this.escribir(CLAVE_FAVORITAS, JSON.stringify(lista));
    return lista;
  }

  eliminarFavorita(id: string): RutaFavorita[] {
    const lista = this.listarFavoritas().filter((entrada) => entrada.id !== id);
    this.escribir(CLAVE_FAVORITAS, JSON.stringify(lista));
    return lista;
  }

  esFavorita(origen: Lugar, destino: Lugar): boolean {
    return this.listarFavoritas().some((entrada) => entrada.id === idFavorita(origen, destino));
  }

  limpiarFavoritas(): void {
    this.borrar(CLAVE_FAVORITAS);
  }

  resumen(): ResumenRutasGuardadas {
    return {
      destinos: this.listarDestinos().length,
      favoritas: this.listarFavoritas().length,
    };
  }
}

export function resumirRutasGuardadas(resumen: ResumenRutasGuardadas): string {
  const partes: string[] = [];
  if (resumen.destinos > 0) {
    partes.push(`${resumen.destinos} ${resumen.destinos === 1 ? 'destino' : 'destinos'}`);
  }
  if (resumen.favoritas > 0) {
    partes.push(`${resumen.favoritas} ${resumen.favoritas === 1 ? 'favorita' : 'favoritas'}`);
  }
  return partes.length ? partes.join(' · ') : 'Sin rutas guardadas';
}
