import { ENRUTAMIENTO } from '../../config';
import type { LatLng, Lugar, PerfilRuta, RutaBici } from '../../types';
import { decodificarPolilinea, longitudRuta } from '../geo';
import { ErrorServicio, pedirJson } from '../http';

interface ValhallaManiobra {
  instruction: string;
  length?: number;
  time?: number;
  street_names?: string[];
  type?: number;
}

interface ValhallaResumen {
  length: number;
  time: number;
  elevation_gained?: number;
  elevation_lost?: number;
}

interface ValhallaRespuesta {
  trip?: {
    summary: ValhallaResumen;
    legs: Array<{
      shape: string;
      maneuvers: ValhallaManiobra[];
      summary?: ValhallaResumen;
    }>;
  };
  error?: string;
  error_code?: number;
}

const PERFILES: Record<
  PerfilRuta,
  { etiqueta: string; cuerpo: Record<string, unknown> }
> = {
  rapida: {
    etiqueta: 'Rápida',
    cuerpo: {
      costing_options: {
        bicycle: {
          bicycle_type: 'road',
          use_roads: 0.9,
          use_hills: 0.4,
          avoid_bad_surfaces: 0.2,
          cycling_speed: 22,
        },
      },
    },
  },
  corta: {
    etiqueta: 'Corta',
    cuerpo: {
      costing_options: {
        bicycle: {
          bicycle_type: 'hybrid',
          use_roads: 0.5,
          use_hills: 0.5,
          avoid_bad_surfaces: 0.5,
          cycling_speed: 18,
        },
      },
    },
  },
  segura: {
    etiqueta: 'Segura',
    cuerpo: {
      costing_options: {
        bicycle: {
          bicycle_type: 'hybrid',
          use_roads: 0.1,
          use_hills: 0.2,
          avoid_bad_surfaces: 1.0,
          cycling_speed: 16,
        },
      },
    },
  },
};

export async function calcularValhalla(
  origen: Lugar,
  destino: Lugar,
  perfil: PerfilRuta,
  signal?: AbortSignal,
): Promise<RutaBici> {
  const config = PERFILES[perfil];
  const cuerpo = {
    locations: [
      { lat: origen.lat, lon: origen.lon },
      { lat: destino.lat, lon: destino.lon },
    ],
    costing: 'bicycle',
    ...config.cuerpo,
    directions_options: { units: 'kilometers', language: 'es-ES' },
  };

  const datos = await pedirJson<ValhallaRespuesta>(ENRUTAMIENTO.valhalla, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    tiempoMaximoMs: ENRUTAMIENTO.tiempoMaximoMs,
    signal,
  });

  if (!datos.trip) {
    throw new ErrorServicio(
      'Valhalla',
      datos.error ?? 'Valhalla no devolvió una ruta.',
      400,
      datos,
    );
  }

  const { summary, legs } = datos.trip;
  const geometria: LatLng[] = [];
  const pasos: RutaBici['pasos'] = [];
  for (const leg of legs) {
    const puntos = decodificarPolilinea(leg.shape, 6);
    if (geometria.length && puntos.length) puntos.shift();
    geometria.push(...puntos);
    for (const m of leg.maneuvers ?? []) {
      pasos.push({
        instruccion: m.instruction || 'Continúa',
        distanciaM: (m.length ?? 0) * 1000,
        duracionS: m.time ?? 0,
        calle: m.street_names?.filter(Boolean).join(', '),
      });
    }
  }

  if (!geometria.length) {
    throw new ErrorServicio('Valhalla', 'La ruta llegó sin geometría.', 502);
  }

  const distanciaM = (summary.length || 0) * 1000 || longitudRuta(geometria);
  const duracionS = summary.time || 0;
  const ascensoM =
    typeof summary.elevation_gained === 'number' ? summary.elevation_gained : undefined;

  return {
    id: `valhalla:${perfil}:${Math.round(distanciaM)}`,
    perfil,
    proveedor: 'valhalla',
    proveedorEtiqueta: 'Valhalla · OpenStreetMap',
    perfilMotor: config.etiqueta,
    distanciaM,
    duracionS,
    ascensoM,
    geometria,
    pasos,
    advertencias:
      perfil === 'segura'
        ? ['Perfil seguro: prioriza ciclorrutas y vías con menor tráfico según los parámetros de Valhalla.']
        : undefined,
    resumen: pasos[0]?.instruccion,
  };
}
