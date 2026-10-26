import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calcularRutaOffline,
  nodoMasCercano,
  procesarGrafo,
} from '../src/lib/routing/offline-graph';
import type { GrafoDatos, PerfilRuta } from '../src/types';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const datos = JSON.parse(
  gunzipSync(readFileSync(resolve(RAIZ, 'public/data/grafo-bogota.json.gz.bin'))).toString('utf8'),
) as GrafoDatos;
const grafo = procesarGrafo(datos);

const ORIGEN = { lat: 4.6767, lon: -74.0483 };
const DESTINO = { lat: 4.5981, lon: -74.076 };

describe('grafo offline de Bogotá', () => {
  it('carga el grafo real con nodos y aristas', () => {
    expect(datos.nodos.length).toBeGreaterThan(300_000);
    expect(datos.aristas.length).toBeGreaterThan(300_000);
    expect(grafo.destinos.length).toBeGreaterThan(600_000);
  });

  it('encuentra nodos cercanos a los puntos de prueba', () => {
    const a = nodoMasCercano(grafo, ORIGEN.lat, ORIGEN.lon);
    const b = nodoMasCercano(grafo, DESTINO.lat, DESTINO.lon);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(a).not.toBe(b);
  });

  it.each<PerfilRuta>(['rapida', 'corta', 'segura'])(
    'calcula una ruta real con el perfil %s',
    (perfil) => {
      const { ruta } = calcularRutaOffline(grafo, ORIGEN, DESTINO, perfil);
      expect(ruta.proveedor).toBe('offline');
      expect(ruta.perfil).toBe(perfil);
      expect(ruta.distanciaM).toBeGreaterThan(7_000);
      expect(ruta.distanciaM).toBeLessThan(25_000);
      expect(ruta.duracionS).toBeGreaterThan(15 * 60);
      expect(ruta.geometria.length).toBeGreaterThan(100);
      expect(ruta.pasos.length).toBeGreaterThan(2);
      expect(ruta.pasos[0].instruccion.startsWith('Sal hacia')).toBe(true);
      expect(ruta.pasos.at(-1)!.instruccion).toBe('Llegaste a tu destino');
      expect(ruta.seguridad).toBeGreaterThan(0);
      for (const [lat, lon] of ruta.geometria) {
        expect(lat).toBeGreaterThan(4.4);
        expect(lat).toBeLessThan(4.9);
        expect(lon).toBeGreaterThan(-74.3);
        expect(lon).toBeLessThan(-73.9);
      }
    },
  );

  it('rechaza puntos alejados de la red ciclable', () => {
    expect(() => calcularRutaOffline(grafo, { lat: 0, lon: 0 }, DESTINO, 'rapida')).toThrow(
      /red ciclable offline/,
    );
  });
});
