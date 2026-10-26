import { DATOS } from '../../config';
import type { PerfilRuta, RutaBici } from '../../types';

interface RespuestaWorker {
  id: number;
  ok: boolean;
  rutas?: RutaBici[];
  error?: string;
  nodos?: number;
  aristas?: number;
  generado?: string;
}

let worker: Worker | null = null;
let secuencia = 0;
const pendientes = new Map<
  number,
  { resolver: (valor: RespuestaWorker) => void; rechazar: (error: Error) => void; temporizador: number }
>();

function urlGrafo(): string {
  return new URL(`${import.meta.env.BASE_URL}${DATOS.grafo}`, window.location.href).href;
}

function obtenerWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./offline.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (evento: MessageEvent<RespuestaWorker>) => {
    const pendiente = pendientes.get(evento.data.id);
    if (!pendiente) return;
    clearTimeout(pendiente.temporizador);
    pendientes.delete(evento.data.id);
    if (evento.data.ok) pendiente.resolver(evento.data);
    else pendiente.rechazar(new Error(evento.data.error ?? 'Error del motor offline.'));
  };
  worker.onerror = (evento) => {
    const error = new Error(evento.message || 'El motor offline no pudo iniciarse.');
    for (const pendiente of pendientes.values()) {
      clearTimeout(pendiente.temporizador);
      pendiente.rechazar(error);
    }
    pendientes.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function enviar(peticion: Record<string, unknown>, tiempoMaximoMs = 60_000): Promise<RespuestaWorker> {
  const id = ++secuencia;
  return new Promise((resolver, rechazar) => {
    const temporizador = window.setTimeout(() => {
      pendientes.delete(id);
      rechazar(new Error('El motor offline tardó demasiado en responder.'));
    }, tiempoMaximoMs);
    pendientes.set(id, { resolver, rechazar, temporizador });
    obtenerWorker().postMessage({ id, grafoUrl: urlGrafo(), ...peticion });
  });
}

export async function calcularOffline(
  origen: { lat: number; lon: number },
  destino: { lat: number; lon: number },
  perfiles: PerfilRuta[] = ['rapida', 'corta', 'segura'],
): Promise<RutaBici[]> {
  const respuesta = await enviar({ tipo: 'ruta', origen, destino, perfiles });
  if (!respuesta.rutas?.length) throw new Error('El motor offline no devolvió rutas.');
  return respuesta.rutas;
}

export async function precargarOffline(): Promise<{
  nodos: number;
  aristas: number;
  generado: string;
}> {
  const respuesta = await enviar({ tipo: 'precargar' }, 90_000);
  return {
    nodos: respuesta.nodos ?? 0,
    aristas: respuesta.aristas ?? 0,
    generado: respuesta.generado ?? '',
  };
}
