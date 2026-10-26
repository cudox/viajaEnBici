import type { GrafoDatos, LatLng, PerfilRuta, RutaBici } from '../../types';
import { distanciaM, girar, puntoCardinal, rumbo } from '../geo';

const RADIO_TIERRA_M = 6_371_008.8;
const CELDA_GRADO = 0.0025;
const RADIO_SNAP_M = 400;

export interface GrafoProcesado {
  datos: GrafoDatos;
  offsets: Int32Array;
  destinos: Int32Array;
  aristas: Int32Array;
  longitudes: Float64Array;
  velocidades: Float32Array;
  seguridad: Float32Array;
  clases: Uint8Array;
  nombres: Int32Array;
  celdas: Map<number, number[]>;
}

export class ErrorGrafo extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorGrafo';
  }
}

function claveCelda(lat: number, lon: number): number {
  const ix = Math.floor((lon + 180) / CELDA_GRADO);
  const iy = Math.floor((lat + 90) / CELDA_GRADO);
  return ix * 100_000 + iy;
}

export function procesarGrafo(datos: GrafoDatos): GrafoProcesado {
  if (!datos?.nodos?.length || !datos?.aristas?.length) {
    throw new ErrorGrafo('El grafo offline está vacío o incompleto.');
  }
  const n = datos.nodos.length;
  const m = datos.aristas.length;
  const longitudes = new Float64Array(m);
  const velocidades = new Float32Array(m);
  const seguridad = new Float32Array(m);
  const clases = new Uint8Array(m);
  const nombres = new Int32Array(m);
  const grados = new Int32Array(n + 1);

  for (let i = 0; i < m; i++) {
    const [a, b, len, cls, nombre, bits, vel, seg] = datos.aristas[i];
    if (a < 0 || b < 0 || a >= n || b >= n) {
      throw new ErrorGrafo(`Arista ${i} con nodos fuera de rango.`);
    }
    longitudes[i] = len;
    velocidades[i] = vel;
    seguridad[i] = seg;
    clases[i] = cls;
    nombres[i] = nombre;
    if (bits & 1) grados[a]++;
    if (bits & 2) grados[b]++;
  }

  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + grados[i];
  const destinos = new Int32Array(offsets[n]);
  const aristas = new Int32Array(offsets[n]);
  const cursor = offsets.slice(0, n);

  for (let i = 0; i < m; i++) {
    const [a, b, , , , bits] = datos.aristas[i];
    if (bits & 1) {
      destinos[cursor[a]] = b;
      aristas[cursor[a]] = i;
      cursor[a]++;
    }
    if (bits & 2) {
      destinos[cursor[b]] = a;
      aristas[cursor[b]] = i;
      cursor[b]++;
    }
  }

  const celdas = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const [lat, lon] = datos.nodos[i];
    const clave = claveCelda(lat, lon);
    const lista = celdas.get(clave);
    if (lista) lista.push(i);
    else celdas.set(clave, [i]);
  }

  return {
    datos,
    offsets,
    destinos,
    aristas,
    longitudes,
    velocidades,
    seguridad,
    clases,
    nombres,
    celdas,
  };
}

export async function descargarGrafo(url: string): Promise<GrafoProcesado> {
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new ErrorGrafo(`No se pudo descargar el grafo offline (HTTP ${respuesta.status}).`);
  }

  const codificacion = respuesta.headers.get('content-encoding') ?? '';
  let texto: string;
  if (codificacion.includes('gzip')) {
    texto = await respuesta.text();
  } else if (url.endsWith('.gz') || url.endsWith('.bin')) {
    if (typeof DecompressionStream === 'undefined') {
      throw new ErrorGrafo(
        'Este navegador no puede descomprimir el grafo offline. Actualiza el navegador o usa la app Android.',
      );
    }
    texto = await new Response(
      respuesta.body!.pipeThrough(new DecompressionStream('gzip')),
    ).text();
  } else {
    texto = await respuesta.text();
  }

  let datos: GrafoDatos;
  try {
    datos = JSON.parse(texto) as GrafoDatos;
  } catch {
    throw new ErrorGrafo('El archivo del grafo offline no es JSON válido.');
  }
  return procesarGrafo(datos);
}

export function nodoMasCercano(grafo: GrafoProcesado, lat: number, lon: number): number {
  const ix = Math.floor((lon + 180) / CELDA_GRADO);
  const iy = Math.floor((lat + 90) / CELDA_GRADO);
  let mejor = -1;
  let mejorDist = Infinity;

  const revisar = (x: number, y: number) => {
    const lista = grafo.celdas.get(x * 100_000 + y);
    if (!lista) return;
    for (const idx of lista) {
      const [nlat, nlon] = grafo.datos.nodos[idx];
      // Aproximación rápida antes del haversine.
      const dLat = Math.abs(nlat - lat);
      const dLon = Math.abs(nlon - lon);
      if (dLat > 0.01 || dLon > 0.01) continue;
      const d = distanciaM([lat, lon], [nlat, nlon]);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = idx;
      }
    }
  };

  for (let radio = 0; radio <= 3 && mejor < 0; radio++) {
    for (let dx = -radio; dx <= radio; dx++) {
      for (let dy = -radio; dy <= radio; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radio) continue;
        revisar(ix + dx, iy + dy);
      }
    }
  }

  if (mejor < 0) {
    for (let i = 0; i < grafo.datos.nodos.length; i++) {
      const [nlat, nlon] = grafo.datos.nodos[i];
      const d = distanciaM([lat, lon], [nlat, nlon]);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = i;
      }
    }
  }

  if (mejor < 0 || mejorDist > RADIO_SNAP_M) {
    throw new ErrorGrafo(
      `El punto está a ${Math.round(mejorDist)} m de la red ciclable offline. Elige un punto más cercano a una vía.`,
    );
  }
  return mejor;
}

class Monticulo {
  private nodos: number[] = [];
  private costos: number[] = [];

  get vacio(): boolean {
    return this.nodos.length === 0;
  }

  insertar(nodo: number, costo: number): void {
    this.nodos.push(nodo);
    this.costos.push(costo);
    let i = this.nodos.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.costos[p] <= this.costos[i]) break;
      [this.costos[p], this.costos[i]] = [this.costos[i], this.costos[p]];
      [this.nodos[p], this.nodos[i]] = [this.nodos[i], this.nodos[p]];
      i = p;
    }
  }

  extraer(): { nodo: number; costo: number } | null {
    if (!this.nodos.length) return null;
    const nodo = this.nodos[0];
    const costo = this.costos[0];
    const ultimoNodo = this.nodos.pop()!;
    const ultimoCosto = this.costos.pop()!;
    if (this.nodos.length) {
      this.nodos[0] = ultimoNodo;
      this.costos[0] = ultimoCosto;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let menor = i;
        if (l < this.nodos.length && this.costos[l] < this.costos[menor]) menor = l;
        if (r < this.nodos.length && this.costos[r] < this.costos[menor]) menor = r;
        if (menor === i) break;
        [this.costos[menor], this.costos[i]] = [this.costos[i], this.costos[menor]];
        [this.nodos[menor], this.nodos[i]] = [this.nodos[i], this.nodos[menor]];
        i = menor;
      }
    }
    return { nodo, costo };
  }
}

function costoArista(grafo: GrafoProcesado, arista: number, perfil: PerfilRuta): number {
  const len = grafo.longitudes[arista];
  if (perfil === 'corta') return len;
  if (perfil === 'segura') return len * grafo.seguridad[arista];
  const mps = Math.max(2, grafo.velocidades[arista] / 3.6);
  return len / mps;
}

const ETIQUETAS_CLASE: Record<string, string> = {
  ciclorruta: 'ciclorruta',
  camino: 'camino',
  peatonal: 'vía peatonal',
  residencial: 'calle residencial',
  servicio: 'vía de servicio',
  otra: 'vía',
  terciaria: 'vía terciaria',
  secundaria: 'vía secundaria',
  primaria: 'vía primaria',
  troncal: 'vía troncal',
};

export interface ResultadoGrafo {
  ruta: RutaBici;
  nodosRecorridos: number;
}

export function calcularRutaOffline(
  grafo: GrafoProcesado,
  origen: { lat: number; lon: number },
  destino: { lat: number; lon: number },
  perfil: PerfilRuta,
): ResultadoGrafo {
  const inicio = nodoMasCercano(grafo, origen.lat, origen.lon);
  const fin = nodoMasCercano(grafo, destino.lat, destino.lon);
  const n = grafo.datos.nodos.length;
  const distancias = new Float64Array(n).fill(Infinity);
  const anteriores = new Int32Array(n).fill(-1);
  const aristaPrevia = new Int32Array(n).fill(-1);
  const cerrados = new Uint8Array(n);
  const monticulo = new Monticulo();
  distancias[inicio] = 0;
  monticulo.insertar(inicio, 0);
  let explorados = 0;

  while (!monticulo.vacio) {
    const actual = monticulo.extraer()!;
    if (cerrados[actual.nodo]) continue;
    cerrados[actual.nodo] = 1;
    explorados++;
    if (actual.nodo === fin) break;

    for (let k = grafo.offsets[actual.nodo]; k < grafo.offsets[actual.nodo + 1]; k++) {
      const arista = grafo.aristas[k];
      const vecino = grafo.destinos[k];
      if (cerrados[vecino]) continue;
      const nuevo = actual.costo + costoArista(grafo, arista, perfil);
      if (nuevo < distancias[vecino]) {
        distancias[vecino] = nuevo;
        anteriores[vecino] = actual.nodo;
        aristaPrevia[vecino] = arista;
        monticulo.insertar(vecino, nuevo);
      }
    }
  }

  if (fin !== inicio && anteriores[fin] === -1) {
    throw new ErrorGrafo('No hay una ruta ciclable offline entre esos puntos.');
  }

  const aristasRuta: number[] = [];
  const nodosRuta: number[] = [fin];
  let cursor = fin;
  while (cursor !== inicio) {
    const previo = anteriores[cursor];
    const arista = aristaPrevia[cursor];
    if (previo < 0 || arista < 0) {
      throw new ErrorGrafo('No se pudo reconstruir la ruta offline.');
    }
    aristasRuta.push(arista);
    nodosRuta.push(previo);
    cursor = previo;
  }
  aristasRuta.reverse();
  nodosRuta.reverse();

  let distanciaTotal = 0;
  let duracionTotal = 0;
  let seguridadPonderada = 0;
  for (const arista of aristasRuta) {
    const len = grafo.longitudes[arista];
    distanciaTotal += len;
    duracionTotal += len / Math.max(1, grafo.velocidades[arista] / 3.6);
    seguridadPonderada += len * grafo.seguridad[arista];
  }

  const geometria: LatLng[] = nodosRuta.map((idx) => {
    const [lat, lon] = grafo.datos.nodos[idx];
    return [lat, lon];
  });

  const pasos = generarPasos(grafo, aristasRuta, nodosRuta);
  const seguridad = distanciaTotal > 0 ? seguridadPonderada / distanciaTotal : undefined;
  const nombresVias = [...new Set(pasos.map((p) => p.calle).filter(Boolean))].slice(0, 3);

  return {
    nodosRecorridos: explorados,
    ruta: {
      id: `offline:${perfil}:${Math.round(distanciaTotal)}`,
      perfil,
      proveedor: 'offline',
      proveedorEtiqueta: 'Motor local · OpenStreetMap',
      perfilMotor: perfil,
      distanciaM: distanciaTotal,
      duracionS: duracionTotal,
      geometria,
      pasos,
      seguridad,
      resumen: nombresVias.length ? `Por ${nombresVias.join(' · ')}` : 'Red ciclable local',
      advertencias: [
        'Ruta calculada sin conexión sobre la red de OpenStreetMap incluida en la app.',
        'No refleja tráfico, obras ni cierres recientes; el tiempo es una estimación por tipo de vía.',
      ],
    },
  };
}

function generarPasos(
  grafo: GrafoProcesado,
  aristasRuta: number[],
  nodosRuta: number[],
): RutaBici['pasos'] {
  if (!aristasRuta.length) return [];

  interface Grupo {
    nombre: string;
    clase: string;
    distancia: number;
    duracion: number;
    inicioNodo: number;
    finNodo: number;
  }

  const grupos: Grupo[] = [];
  for (let i = 0; i < aristasRuta.length; i++) {
    const arista = aristasRuta[i];
    const idxNombre = grafo.nombres[arista];
    const nombre = idxNombre >= 0 ? (grafo.datos.nombres[idxNombre] ?? '') : '';
    const clase = grafo.datos.clases[grafo.clases[arista]]?.id ?? 'otra';
    const len = grafo.longitudes[arista];
    const dur = len / Math.max(1, grafo.velocidades[arista] / 3.6);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nombre === nombre && ultimo.clase === clase) {
      ultimo.distancia += len;
      ultimo.duracion += dur;
      ultimo.finNodo = i + 1;
    } else {
      grupos.push({
        nombre,
        clase,
        distancia: len,
        duracion: dur,
        inicioNodo: i,
        finNodo: i + 1,
      });
    }
  }

  const pasos: RutaBici['pasos'] = [];
  const nombreVisible = (g: Grupo) => g.nombre || ETIQUETAS_CLASE[g.clase] || 'la vía';

  for (let i = 0; i < grupos.length; i++) {
    const grupo = grupos[i];
    const calle = nombreVisible(grupo);
    let instruccion: string;

    if (i === 0) {
      const inicial = rumbo(
        grafo.datos.nodos[nodosRuta[0]],
        grafo.datos.nodos[nodosRuta[1] ?? nodosRuta[0]],
      );
      instruccion = `Sal hacia el ${puntoCardinal(inicial)} por ${calle}`;
    } else {
      const nodo = nodosRuta[grupo.inicioNodo];
      const anterior = nodosRuta[grupo.inicioNodo - 1] ?? nodo;
      const siguiente = nodosRuta[grupo.inicioNodo + 1] ?? nodo;
      const entrada = rumbo(grafo.datos.nodos[anterior], grafo.datos.nodos[nodo]);
      const salida = rumbo(grafo.datos.nodos[nodo], grafo.datos.nodos[siguiente]);
      const giro = girar(entrada, salida);
      if (giro === 'frente') instruccion = `Continúa por ${calle}`;
      else if (giro === 'giro en U') instruccion = `Gira en U y continúa por ${calle}`;
      else instruccion = `Gira a la ${giro} por ${calle}`;
    }

    pasos.push({
      instruccion,
      distanciaM: grupo.distancia,
      duracionS: grupo.duracion,
      calle: grupo.nombre || undefined,
    });
  }

  pasos.push({
    instruccion: 'Llegaste a tu destino',
    distanciaM: 0,
    duracionS: 0,
  });
  return pasos;
}

/** Utilidad de diagnóstico: longitud total de un grafo cargado. */
export function longitudTotalRed(grafo: GrafoProcesado): number {
  let total = 0;
  for (let i = 0; i < grafo.longitudes.length; i++) {
    const bits = grafo.datos.aristas[i][5];
    total += grafo.longitudes[i] * (bits === 3 ? 2 : 1);
  }
  return total;
}

export function distanciaAproximada(a: [number, number], b: [number, number]): number {
  return distanciaM(a, b);
}

export { RADIO_TIERRA_M };
