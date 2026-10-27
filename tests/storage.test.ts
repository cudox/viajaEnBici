import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLAVE_DESTINOS, CLAVE_FAVORITAS } from '../src/lib/rutas-guardadas';
import {
  PREFERENCIAS_INICIALES,
  borrarDatosLocales,
  cargarPreferencias,
  cargarSesion,
  guardarSesion,
} from '../src/lib/storage';

class AlmacenLocalFalso {
  readonly datos = new Map<string, string>();

  get length(): number {
    return this.datos.size;
  }

  clear(): void {
    this.datos.clear();
  }

  getItem(clave: string): string | null {
    return this.datos.get(clave) ?? null;
  }

  key(indice: number): string | null {
    return [...this.datos.keys()][indice] ?? null;
  }

  removeItem(clave: string): void {
    this.datos.delete(clave);
  }

  setItem(clave: string, valor: string): void {
    this.datos.set(clave, valor);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function instalarAlmacen(): AlmacenLocalFalso {
  const almacen = new AlmacenLocalFalso();
  vi.stubGlobal('localStorage', almacen);
  return almacen;
}

describe('preferencias', () => {
  it('activa el guardado de destinos para preferencias antiguas', () => {
    const almacen = instalarAlmacen();
    almacen.setItem('veb.prefs.v1', JSON.stringify({ tema: 'oscuro' }));

    const prefs = cargarPreferencias();
    expect(prefs.guardarRecientes).toBe(true);
    expect(prefs.tema).toBe('oscuro');
    expect(prefs.ultimoPerfil).toBe(PREFERENCIAS_INICIALES.ultimoPerfil);
  });

  it('respeta el guardado desactivado', () => {
    const almacen = instalarAlmacen();
    almacen.setItem(
      'veb.prefs.v1',
      JSON.stringify({ ...PREFERENCIAS_INICIALES, guardarRecientes: false }),
    );
    expect(cargarPreferencias().guardarRecientes).toBe(false);
  });
});

describe('sesión de la última consulta', () => {
  it('trata un origen guardado antiguo como manual', () => {
    const almacen = instalarAlmacen();
    almacen.setItem(
      'veb.sesion.v1',
      JSON.stringify({
        origen: { etiqueta: 'Parque de la 93', lat: 4.6767, lon: -74.0483 },
        destino: { etiqueta: 'Plaza de Bolívar', lat: 4.5981, lon: -74.076 },
      }),
    );

    const sesion = cargarSesion();
    expect(sesion.origenModo).toBe('manual');
    expect(sesion.origen?.etiqueta).toBe('Parque de la 93');
  });

  it('usa el modo GPS si no hay origen guardado', () => {
    const almacen = instalarAlmacen();
    almacen.setItem('veb.sesion.v1', JSON.stringify({ destino: { etiqueta: 'Plaza', lat: 4.6, lon: -74.1 } }));

    expect(cargarSesion().origenModo).toBe('actual');
  });

  it('corrige un modo manual sin coordenadas a GPS', () => {
    const almacen = instalarAlmacen();
    almacen.setItem('veb.sesion.v1', JSON.stringify({ origenModo: 'manual' }));

    expect(cargarSesion().origenModo).toBe('actual');
  });

  it('conserva el modo GPS sin guardar coordenadas de origen', () => {
    instalarAlmacen();
    guardarSesion({
      origenModo: 'actual',
      destino: { etiqueta: 'Plaza', lat: 4.6, lon: -74.1 },
    });
    expect(cargarSesion().origen).toBeUndefined();
    expect(cargarSesion().origenModo).toBe('actual');
  });
});

describe('limpieza de datos', () => {
  it('borra preferencias, sesión, destinos y favoritas', () => {
    const almacen = instalarAlmacen();
    almacen.setItem('veb.prefs.v1', '{}');
    almacen.setItem('veb.sesion.v1', '{}');
    almacen.setItem(CLAVE_DESTINOS, '[]');
    almacen.setItem(CLAVE_FAVORITAS, '[]');
    almacen.setItem('veb.ultimaRuta.v1', '{}');

    borrarDatosLocales();
    expect(almacen.length).toBe(0);
  });
});
