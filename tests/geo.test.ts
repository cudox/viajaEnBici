import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodificarPolilinea,
  diferenciaAngulo,
  distanciaM,
  girar,
  puntoCardinal,
  rumbo,
} from '../src/lib/geo';
import { formatearDistancia, formatearDuracion } from '../src/lib/format';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('geometría', () => {
  it('calcula distancias haversine con precisión razonable', () => {
    const bogota = distanciaM([4.6767, -74.0483], [4.5981, -74.076]);
    expect(bogota).toBeGreaterThan(8_500);
    expect(bogota).toBeLessThan(9_500);
    expect(distanciaM([4.6, -74.1], [4.6, -74.1])).toBe(0);
  });

  it('calcula rumbos cardinales', () => {
    expect(rumbo([4.6, -74.1], [4.7, -74.1])).toBeCloseTo(0, 0);
    expect(rumbo([4.6, -74.1], [4.6, -74.0])).toBeCloseTo(90, 0);
    expect(puntoCardinal(0)).toBe('norte');
    expect(puntoCardinal(90)).toBe('este');
    expect(puntoCardinal(225)).toBe('suroeste');
  });

  it('clasifica giros y normaliza ángulos', () => {
    expect(girar(0, 10)).toBe('frente');
    expect(girar(0, 90)).toBe('derecha');
    expect(girar(0, 270)).toBe('izquierda');
    expect(girar(0, 180)).toBe('giro en U');
    expect(diferenciaAngulo(350, 10)).toBe(20);
    expect(diferenciaAngulo(10, 350)).toBe(-20);
  });

  it('decodifica la polilínea real de Valhalla', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(RAIZ, 'tests/fixtures/valhalla-rapida.json'), 'utf8'),
    );
    const puntos = decodificarPolilinea(fixture.trip.legs[0].shape, 6);
    expect(puntos.length).toBeGreaterThan(50);
    expect(puntos[0][0]).toBeCloseTo(4.6767, 3);
    expect(puntos[0][1]).toBeCloseTo(-74.0483, 3);
    expect(puntos.at(-1)![0]).toBeCloseTo(4.5981, 3);
    expect(puntos.at(-1)![1]).toBeCloseTo(-74.076, 3);
  });
});

describe('formato en español', () => {
  it('muestra metros y kilómetros con un decimal', () => {
    expect(formatearDistancia(420)).toBe('420 m');
    expect(formatearDistancia(10_125)).toBe('10.1 km');
    expect(formatearDistancia(9_662)).toBe('9.7 km');
  });

  it('muestra duraciones legibles', () => {
    expect(formatearDuracion(31 * 60)).toBe('31 min');
    expect(formatearDuracion(90 * 60)).toBe('1 h 30 min');
    expect(formatearDuracion(120 * 60)).toBe('2 h');
  });
});
