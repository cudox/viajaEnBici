import { describe, expect, it } from 'vitest';
import {
  CLAVE_DESTINOS,
  CLAVE_FAVORITAS,
  MAX_DESTINOS,
  MAX_FAVORITAS,
  RutasGuardadas,
  claveLugar,
  idDestino,
  resumirRutasGuardadas,
  type Almacen,
} from '../src/lib/rutas-guardadas';
import type { Lugar } from '../src/types';

class AlmacenMemoria implements Almacen {
  readonly datos = new Map<string, string>();

  getItem(clave: string): string | null {
    return this.datos.get(clave) ?? null;
  }

  setItem(clave: string, valor: string): void {
    this.datos.set(clave, valor);
  }

  removeItem(clave: string): void {
    this.datos.delete(clave);
  }
}

function crearLugar(etiqueta: string, lat: number, lon: number): Lugar {
  return { etiqueta, lat, lon };
}

function crearEntorno(): {
  almacen: AlmacenMemoria;
  rutas: RutasGuardadas;
  avanzar: (ms: number) => void;
} {
  const almacen = new AlmacenMemoria();
  let fecha = new Date('2026-10-26T12:00:00.000Z');
  const rutas = new RutasGuardadas(almacen, () => fecha);
  return {
    almacen,
    rutas,
    avanzar: (ms) => {
      fecha = new Date(fecha.getTime() + ms);
    },
  };
}

describe('destinos recientes', () => {
  it('guarda el destino, deduplica y conserva el más reciente primero', () => {
    const { rutas, avanzar } = crearEntorno();
    const plaza = crearLugar('Plaza de Bolívar', 4.5981, -74.076);
    const parque = crearLugar('Parque de la 93', 4.6767, -74.0483);

    rutas.registrarDestino(plaza);
    avanzar(60_000);
    rutas.registrarDestino(parque);
    avanzar(60_000);
    rutas.registrarDestino(crearLugar('Plaza de Bolívar, Bogotá', 4.5981, -74.076));

    const lista = rutas.listarDestinos();
    expect(lista).toHaveLength(2);
    expect(lista[0].id).toBe(idDestino(plaza));
    expect(lista[0].destino.etiqueta).toBe('Plaza de Bolívar, Bogotá');
    expect(lista[0].veces).toBe(2);
    expect(lista[0].ultimaVez).toBe('2026-10-26T12:02:00.000Z');
    expect(lista[1].destino.etiqueta).toBe('Parque de la 93');
    expect(lista[1].veces).toBe(1);
  });

  it('limita el historial y descarta el destino más antiguo', () => {
    const { rutas } = crearEntorno();
    for (let indice = 0; indice <= MAX_DESTINOS; indice += 1) {
      rutas.registrarDestino(
        crearLugar(`Destino ${indice}`, 4.6 + indice * 0.0001, -74.1),
      );
    }

    const lista = rutas.listarDestinos();
    expect(lista).toHaveLength(MAX_DESTINOS);
    expect(lista[0].destino.etiqueta).toBe(`Destino ${MAX_DESTINOS}`);
    expect(lista.some((entrada) => entrada.destino.etiqueta === 'Destino 0')).toBe(false);
  });

  it('elimina un destino y limpia el historial', () => {
    const { rutas } = crearEntorno();
    const plaza = crearLugar('Plaza de Bolívar', 4.5981, -74.076);
    const parque = crearLugar('Parque de la 93', 4.6767, -74.0483);
    rutas.registrarDestino(plaza);
    rutas.registrarDestino(parque);

    expect(rutas.eliminarDestino(idDestino(plaza))).toHaveLength(1);
    expect(rutas.listarDestinos()[0].destino.etiqueta).toBe('Parque de la 93');

    rutas.limpiarDestinos();
    expect(rutas.listarDestinos()).toEqual([]);
  });

  it('ignora JSON corrupto y entradas con coordenadas inválidas', () => {
    const { almacen, rutas } = crearEntorno();
    almacen.setItem(CLAVE_DESTINOS, '{no es json');
    expect(rutas.listarDestinos()).toEqual([]);

    almacen.setItem(
      CLAVE_DESTINOS,
      JSON.stringify([
        {
          id: 'destino:4.60000,-74.10000',
          destino: { etiqueta: 'Válido', lat: 4.6, lon: -74.1 },
          ultimaVez: '2026-10-26T12:00:00.000Z',
          veces: 1,
        },
        {
          id: 'destino:roto',
          destino: { etiqueta: 'Roto', lat: '4.6', lon: -74.1 },
          ultimaVez: '2026-10-26T12:00:00.000Z',
          veces: 1,
        },
      ]),
    );
    expect(rutas.listarDestinos()).toHaveLength(1);
    expect(rutas.listarDestinos()[0].destino.etiqueta).toBe('Válido');
  });
});

describe('rutas favoritas', () => {
  it('guarda una favorita con nombres, métricas y perfil', () => {
    const { rutas } = crearEntorno();
    const origen = crearLugar('Parque de la 93', 4.6767, -74.0483);
    const destino = crearLugar('Plaza de Bolívar', 4.5981, -74.076);

    rutas.guardarFavorita(origen, destino, {
      perfil: 'rapida',
      distanciaM: 10_125,
      duracionS: 1_865,
    });

    const favoritas = rutas.listarFavoritas();
    expect(favoritas).toHaveLength(1);
    expect(favoritas[0].nombre).toContain('Parque de la 93');
    expect(favoritas[0].perfil).toBe('rapida');
    expect(favoritas[0].distanciaM).toBe(10_125);
    expect(rutas.esFavorita(origen, destino)).toBe(true);
  });

  it('actualiza una favorita existente sin cambiar su fecha de creación', () => {
    const { rutas, avanzar } = crearEntorno();
    const origen = crearLugar('Origen', 4.6, -74.1);
    const destino = crearLugar('Destino', 4.7, -74.05);

    rutas.guardarFavorita(origen, destino, { perfil: 'rapida' });
    const creada = rutas.listarFavoritas()[0].creada;
    avanzar(3_600_000);
    rutas.guardarFavorita(origen, destino, {
      nombre: 'Mi ruta',
      perfil: 'segura',
      duracionS: 900,
    });

    const favoritas = rutas.listarFavoritas();
    expect(favoritas).toHaveLength(1);
    expect(favoritas[0].nombre).toBe('Mi ruta');
    expect(favoritas[0].perfil).toBe('segura');
    expect(favoritas[0].creada).toBe(creada);
    expect(favoritas[0].actualizada).not.toBe(creada);
  });

  it('elimina favoritas y limita la lista', () => {
    const { rutas } = crearEntorno();
    const origen = crearLugar('Origen', 4.6, -74.1);
    const destino = crearLugar('Destino', 4.7, -74.05);
    rutas.guardarFavorita(origen, destino);
    const id = rutas.listarFavoritas()[0].id;
    expect(rutas.eliminarFavorita(id)).toEqual([]);
    expect(rutas.esFavorita(origen, destino)).toBe(false);

    for (let indice = 0; indice <= MAX_FAVORITAS; indice += 1) {
      rutas.guardarFavorita(
        crearLugar('Origen', 4.6, -74.1),
        crearLugar(`Destino ${indice}`, 4.7 + indice * 0.0001, -74.05),
      );
    }
    expect(rutas.listarFavoritas()).toHaveLength(MAX_FAVORITAS);
  });
});

describe('utilidades de Mis rutas', () => {
  it('normaliza la clave de un lugar a cinco decimales', () => {
    expect(claveLugar(crearLugar('Punto', 4.6767123, -74.0483456))).toBe(
      '4.67671,-74.04835',
    );
  });

  it('resume los contadores en singular y plural', () => {
    expect(resumirRutasGuardadas({ destinos: 0, favoritas: 0 })).toBe('Sin rutas guardadas');
    expect(resumirRutasGuardadas({ destinos: 1, favoritas: 1 })).toBe(
      '1 destino · 1 favorita',
    );
    expect(resumirRutasGuardadas({ destinos: 3, favoritas: 2 })).toBe(
      '3 destinos · 2 favoritas',
    );
  });

  it('mantiene los datos en memoria si el almacenamiento falla', () => {
    const fallido: Almacen = {
      getItem: () => null,
      setItem: () => {
        throw new Error('cuota llena');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    };
    const rutas = new RutasGuardadas(fallido, () => new Date('2026-10-26T12:00:00.000Z'));
    rutas.registrarDestino(crearLugar('Plaza', 4.5981, -74.076));
    expect(rutas.listarDestinos()).toHaveLength(1);
    expect(rutas.listarFavoritas()).toEqual([]);
  });
});
