import type { LatLng } from '../types';

const RADIO_TIERRA_M = 6_371_008.8;

export function distanciaM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function longitudRuta(puntos: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) total += distanciaM(puntos[i - 1], puntos[i]);
  return total;
}

/** Rumbo inicial en grados (0 = norte, 90 = este). */
export function rumbo(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const dLon = (b[1] - a[1]) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function diferenciaAngulo(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

export function puntoCardinal(grados: number): string {
  const cardinales = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  return cardinales[Math.round(((grados + 360) % 360) / 45) % 8];
}

export function girar(a: number, b: number): 'izquierda' | 'derecha' | 'frente' | 'giro en U' {
  const d = diferenciaAngulo(a, b);
  if (Math.abs(d) < 25) return 'frente';
  if (Math.abs(d) > 150) return 'giro en U';
  return d > 0 ? 'derecha' : 'izquierda';
}

/**
 * Decodifica una polilínea codificada de Google/Valhalla.
 * Valhalla usa precisión 6 por defecto.
 */
export function decodificarPolilinea(codificada: string, precision = 6): LatLng[] {
  const puntos: LatLng[] = [];
  let indice = 0;
  let lat = 0;
  let lon = 0;
  const factor = 10 ** precision;

  while (indice < codificada.length) {
    let resultado = 0;
    let desplazamiento = 0;
    let byte: number;
    do {
      byte = codificada.charCodeAt(indice++) - 63;
      resultado |= (byte & 0x1f) << desplazamiento;
      desplazamiento += 5;
    } while (byte >= 0x20);
    lat += resultado & 1 ? ~(resultado >> 1) : resultado >> 1;

    resultado = 0;
    desplazamiento = 0;
    do {
      byte = codificada.charCodeAt(indice++) - 63;
      resultado |= (byte & 0x1f) << desplazamiento;
      desplazamiento += 5;
    } while (byte >= 0x20);
    lon += resultado & 1 ? ~(resultado >> 1) : resultado >> 1;

    puntos.push([lat / factor, lon / factor]);
  }
  return puntos;
}

export function dentroDeBogota(lat: number, lon: number): boolean {
  return lat >= 4.4 && lat <= 4.9 && lon >= -74.3 && lon <= -73.9;
}

export function bboxDePuntos(puntos: LatLng[]): [[number, number], [number, number]] {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of puntos) {
    minLat = Math.min(minLat, lat);
    minLon = Math.min(minLon, lon);
    maxLat = Math.max(maxLat, lat);
    maxLon = Math.max(maxLon, lon);
  }
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

export function interpolar(a: LatLng, b: LatLng, t: number): LatLng {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
