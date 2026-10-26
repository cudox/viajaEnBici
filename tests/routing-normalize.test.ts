import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcularValhalla } from '../src/lib/routing/valhalla';
import { calcularBrouter } from '../src/lib/routing/brouter';
import { calcularMapasBogota } from '../src/lib/routing/mapas-bogota';
import type { Lugar } from '../src/types';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN: Lugar = { etiqueta: 'Parque de la 93', lat: 4.6767, lon: -74.0483 };
const DESTINO: Lugar = { etiqueta: 'Plaza de Bolívar', lat: 4.5981, lon: -74.076 };

function leerFixture(nombre: string): unknown {
  return JSON.parse(readFileSync(resolve(RAIZ, `tests/fixtures/${nombre}`), 'utf8'));
}

function simularRespuesta(datos: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify(datos), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalización de Valhalla', () => {
  it('convierte la respuesta real en una ruta de la app', async () => {
    simularRespuesta(leerFixture('valhalla-rapida.json'));
    const ruta = await calcularValhalla(ORIGEN, DESTINO, 'rapida');
    expect(ruta.proveedor).toBe('valhalla');
    expect(ruta.distanciaM).toBeCloseTo(10_125, 0);
    expect(ruta.duracionS).toBeCloseTo(1_864.9, 0);
    expect(ruta.geometria.length).toBeGreaterThan(100);
    expect(ruta.pasos.length).toBeGreaterThan(5);
    expect(ruta.pasos[0].instruccion).toContain('Calle 93A');
    expect(ruta.geometria[0][0]).toBeCloseTo(4.6767, 3);
  });
});

describe('normalización de BRouter', () => {
  it('convierte el GeoJSON real y conserva los totales', async () => {
    simularRespuesta(leerFixture('brouter-fastbike.json'));
    const ruta = await calcularBrouter(ORIGEN, DESTINO, 'fastbike');
    expect(ruta.proveedor).toBe('brouter');
    expect(ruta.distanciaM).toBe(9_662);
    expect(ruta.duracionS).toBe(2_005);
    expect(ruta.ascensoM).toBe(64);
    expect(ruta.geometria.length).toBeGreaterThan(100);
    expect(ruta.advertencias?.[0]).toContain('giro a giro');
  });
});

describe('normalización de Mapas Bogotá', () => {
  it('extrae las tres alternativas y sus instrucciones', async () => {
    simularRespuesta(leerFixture('mapas-bogota.json'));
    const rutas = await calcularMapasBogota(ORIGEN, DESTINO);
    expect(rutas).toHaveLength(3);
    expect(rutas[0].proveedor).toBe('mapas');
    expect(rutas[0].distanciaM).toBeCloseTo(9_846, 0);
    expect(rutas[0].duracionS).toBeCloseTo(2_088, 0);
    expect(rutas[0].geometria.length).toBeGreaterThan(20);
    expect(rutas[0].pasos.length).toBeGreaterThan(5);
    expect(rutas[1].distanciaM).toBeGreaterThan(rutas[0].distanciaM);
  });
});
