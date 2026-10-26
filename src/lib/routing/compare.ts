import { ENRUTAMIENTO } from '../../config';
import type {
  ConjuntoRutas,
  EstadoFuente,
  Lugar,
  PerfilRuta,
  RutaBici,
} from '../../types';
import { mensajeError } from '../http';
import { calcularBrouter } from './brouter';
import { calcularMapasBogota } from './mapas-bogota';
import { calcularOffline } from './offline-client';
import { calcularValhalla } from './valhalla';

interface OpcionesComparar {
  origen: Lugar;
  destino: Lugar;
  usarOffline: boolean;
  signal?: AbortSignal;
}

const cache = new Map<string, { expira: number; conjunto: ConjuntoRutas }>();

function claveCache(origen: Lugar, destino: Lugar, offline: boolean): string {
  return [
    origen.lat.toFixed(5),
    origen.lon.toFixed(5),
    destino.lat.toFixed(5),
    destino.lon.toFixed(5),
    offline ? 'offline' : 'online',
  ].join('|');
}

function claveBase(ruta: RutaBici): string {
  return `${ruta.proveedor}:${Math.round(ruta.distanciaM)}:${Math.round(ruta.duracionS)}`;
}

function conPerfil(ruta: RutaBici, perfil: PerfilRuta): RutaBici {
  return { ...ruta, id: `${ruta.id}#${perfil}`, perfil };
}

function conjuntoOffline(rutas: RutaBici[], avisos: string[] = []): ConjuntoRutas {
  const porPerfil = new Map(rutas.map((r) => [r.perfil, r]));
  const rapida = porPerfil.get('rapida');
  const corta = porPerfil.get('corta');
  const segura =
    porPerfil.get('segura') ??
    [...rutas].sort((a, b) => (a.seguridad ?? 99) - (b.seguridad ?? 99))[0];

  if (!rapida || !corta || !segura) {
    throw new Error('El motor offline no devolvió los tres perfiles.');
  }

  return {
    rapida,
    corta,
    segura,
    alternativas: [],
    generado: new Date().toISOString(),
    avisos: [
      'Rutas calculadas en tu dispositivo con la red ciclable de OpenStreetMap incluida en la app.',
      'Sin conexión no se consultan tráfico, obras ni el estado actual de las ciclorrutas.',
      ...avisos,
    ],
    fuentes: [
      {
        nombre: 'Motor local OSM',
        ok: true,
        detalle: `${rutas.length} perfiles sobre el grafo descargado`,
      },
    ],
    offline: true,
  };
}

async function compararOnline(opciones: OpcionesComparar): Promise<ConjuntoRutas> {
  const { origen, destino, signal } = opciones;
  const tareas: Array<{
    nombre: string;
    ejecutar: () => Promise<RutaBici[]>;
  }> = [
    {
      nombre: 'Valhalla · rápida',
      ejecutar: async () => [await calcularValhalla(origen, destino, 'rapida', signal)],
    },
    {
      nombre: 'Valhalla · corta',
      ejecutar: async () => [await calcularValhalla(origen, destino, 'corta', signal)],
    },
    {
      nombre: 'Valhalla · segura',
      ejecutar: async () => [await calcularValhalla(origen, destino, 'segura', signal)],
    },
    {
      nombre: 'BRouter · fastbike',
      ejecutar: async () => [await calcularBrouter(origen, destino, 'fastbike', signal)],
    },
    {
      nombre: 'Mapas Bogotá',
      ejecutar: () => calcularMapasBogota(origen, destino, signal),
    },
  ];

  const resultados = await Promise.allSettled(tareas.map((t) => t.ejecutar()));
  if (signal?.aborted) throw new Error('Consulta cancelada.');

  const rutas: RutaBici[] = [];
  const fuentes: EstadoFuente[] = [];
  const avisos: string[] = [];

  resultados.forEach((resultado, indice) => {
    const tarea = tareas[indice];
    if (resultado.status === 'fulfilled' && resultado.value.length) {
      rutas.push(...resultado.value);
      fuentes.push({
        nombre: tarea.nombre,
        ok: true,
        detalle:
          resultado.value.length > 1
            ? `${resultado.value.length} alternativas`
            : `${(resultado.value[0].distanciaM / 1000).toFixed(1)} km`,
      });
    } else {
      const detalle =
        resultado.status === 'rejected'
          ? mensajeError(resultado.reason)
          : 'Sin resultados';
      fuentes.push({ nombre: tarea.nombre, ok: false, detalle });
      avisos.push(`No se pudo consultar ${tarea.nombre}: ${detalle}`);
    }
  });

  if (!rutas.length) {
    throw new Error(
      `Ningún motor en línea devolvió una ruta. ${avisos[0] ?? 'Revisa la conexión.'}`,
    );
  }

  const porDuracion = [...rutas].sort(
    (a, b) => a.duracionS - b.duracionS || a.distanciaM - b.distanciaM,
  );
  const porDistancia = [...rutas].sort(
    (a, b) => a.distanciaM - b.distanciaM || a.duracionS - b.duracionS,
  );

  const rapidaBase = porDuracion[0];
  const cortaBase =
    porDistancia.find((r) => claveBase(r) !== claveBase(rapidaBase)) ?? porDistancia[0];
  const seguraBase =
    rutas.find((r) => r.proveedor === 'valhalla' && r.perfil === 'segura') ??
    rutas.find((r) => r.proveedor === 'offline') ??
    rapidaBase;

  const rapida = conPerfil(rapidaBase, 'rapida');
  const corta = conPerfil(cortaBase, 'corta');
  const segura = conPerfil(seguraBase, 'segura');

  const usadas = new Set([claveBase(rapidaBase), claveBase(cortaBase), claveBase(seguraBase)]);
  const alternativas: RutaBici[] = [];
  const vistas = new Set<string>();
  for (const ruta of porDuracion) {
    const clave = claveBase(ruta);
    if (usadas.has(clave) || vistas.has(clave)) continue;
    vistas.add(clave);
    alternativas.push(ruta);
    if (alternativas.length >= 4) break;
  }

  avisos.unshift(
    'Rápida = menor duración; corta = menor distancia; segura = perfil de Valhalla que prioriza ciclorrutas y evita vías de tráfico.',
    'Los tiempos son estimaciones de cada motor y no son directamente comparables entre sí.',
    'Servicios públicos de demostración: para producción se recomienda autohospedar los motores y respetar sus políticas de uso.',
  );
  if (claveBase(rapidaBase) === claveBase(cortaBase)) {
    avisos.push('La ruta más rápida también resultó la más corta entre las alternativas disponibles.');
  }

  return {
    rapida,
    corta,
    segura,
    alternativas,
    generado: new Date().toISOString(),
    avisos,
    fuentes,
    offline: false,
  };
}

export async function compararRutas(opciones: OpcionesComparar): Promise<ConjuntoRutas> {
  const clave = claveCache(opciones.origen, opciones.destino, opciones.usarOffline);
  const enCache = cache.get(clave);
  if (enCache && enCache.expira > Date.now()) return enCache.conjunto;

  let conjunto: ConjuntoRutas;
  if (opciones.usarOffline) {
    try {
      const rutas = await calcularOffline(
        { lat: opciones.origen.lat, lon: opciones.origen.lon },
        { lat: opciones.destino.lat, lon: opciones.destino.lon },
        ['rapida', 'corta', 'segura'],
      );
      conjunto = conjuntoOffline(rutas);
    } catch (error) {
      throw new Error(`No se pudo calcular la ruta sin conexión: ${mensajeError(error)}`);
    }
  } else {
    try {
      conjunto = await compararOnline(opciones);
    } catch (error) {
      if (opciones.signal?.aborted) throw error;
      // Si los servicios en línea fallan, se intenta el motor local como respaldo real.
      try {
        const rutas = await calcularOffline(
          { lat: opciones.origen.lat, lon: opciones.origen.lon },
          { lat: opciones.destino.lat, lon: opciones.destino.lon },
          ['rapida', 'corta', 'segura'],
        );
        conjunto = conjuntoOffline(rutas, [
          `Los servicios en línea fallaron (${mensajeError(error)}). Se usó el motor local.`,
        ]);
      } catch (errorOffline) {
        throw new Error(
          `${mensajeError(error)} Tampoco fue posible usar el motor local: ${mensajeError(errorOffline)}`,
        );
      }
    }
  }

  cache.set(clave, { expira: Date.now() + ENRUTAMIENTO.cacheMs, conjunto });
  return conjunto;
}

export function limpiarCacheRutas(): void {
  cache.clear();
}
