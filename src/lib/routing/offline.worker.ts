import type { PerfilRuta, RutaBici } from '../../types';
import { calcularRutaOffline, descargarGrafo, type GrafoProcesado } from './offline-graph';

interface PeticionRuta {
  id: number;
  tipo: 'ruta';
  grafoUrl: string;
  origen: { lat: number; lon: number };
  destino: { lat: number; lon: number };
  perfiles: PerfilRuta[];
}

interface PeticionPrecarga {
  id: number;
  tipo: 'precargar';
  grafoUrl: string;
}

type Peticion = PeticionRuta | PeticionPrecarga;

interface RespuestaOk {
  id: number;
  ok: true;
  rutas?: RutaBici[];
  nodos?: number;
  aristas?: number;
  generado?: string;
}

interface RespuestaError {
  id: number;
  ok: false;
  error: string;
}

let grafo: GrafoProcesado | null = null;
let urlCargada = '';

async function asegurarGrafo(url: string): Promise<GrafoProcesado> {
  if (grafo && urlCargada === url) return grafo;
  grafo = await descargarGrafo(url);
  urlCargada = url;
  return grafo;
}

self.onmessage = async (evento: MessageEvent<Peticion>) => {
  const peticion = evento.data;
  try {
    if (peticion.tipo === 'precargar') {
      const g = await asegurarGrafo(peticion.grafoUrl);
      const respuesta: RespuestaOk = {
        id: peticion.id,
        ok: true,
        nodos: g.datos.nodos.length,
        aristas: g.datos.aristas.length,
        generado: g.datos.generado,
      };
      (self as unknown as Worker).postMessage(respuesta);
      return;
    }

    if (peticion.tipo === 'ruta') {
      const g = await asegurarGrafo(peticion.grafoUrl);
      const rutas = peticion.perfiles.map(
        (perfil) =>
          calcularRutaOffline(g, peticion.origen, peticion.destino, perfil).ruta,
      );
      const respuesta: RespuestaOk = { id: peticion.id, ok: true, rutas };
      (self as unknown as Worker).postMessage(respuesta);
      return;
    }
  } catch (error) {
    const respuesta: RespuestaError = {
      id: peticion.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(respuesta);
  }
};
