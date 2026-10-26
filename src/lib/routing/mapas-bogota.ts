import { ENRUTAMIENTO } from '../../config';
import type { LatLng, Lugar, RutaBici } from '../../types';
import { longitudRuta } from '../geo';
import { ErrorServicio, pedirJson } from '../http';

interface InstruccionGraphHopper {
  distance?: number;
  time?: number;
  text?: string;
  street_name?: string;
  sign?: number;
  interval?: [number, number];
}

interface CaminoGraphHopper {
  distance: number;
  time: number;
  ascend?: number;
  descend?: number;
  points?: { type: string; coordinates: Array<[number, number, number?]> };
  instructions?: InstruccionGraphHopper[];
}

interface RespuestaMapas {
  response?: { paths?: CaminoGraphHopper[] };
  message?: string;
}

/**
 * API de Ruteo de Mapas Bogotá (Catastro Distrital), que expone GraphHopper
 * con perfiles bike/car/foot y respuestas en español.
 */
export async function calcularMapasBogota(
  origen: Lugar,
  destino: Lugar,
  signal?: AbortSignal,
): Promise<RutaBici[]> {
  const params = new URLSearchParams({
    type: 'json',
    locale: 'es',
    points_encoded: 'false',
    elevation: 'true',
    'ch.disable': 'true',
    algorithm: 'alternative_route',
    'alternative_route.max_paths': '3',
    vehicle: 'bike',
  });
  params.append('point', `${origen.lat},${origen.lon}`);
  params.append('point', `${destino.lat},${destino.lon}`);

  const datos = await pedirJson<RespuestaMapas>(`${ENRUTAMIENTO.mapasBogota}?${params}`, {
    tiempoMaximoMs: ENRUTAMIENTO.tiempoMaximoMs,
    signal,
  });

  const caminos = datos.response?.paths ?? [];
  if (!caminos.length) {
    throw new ErrorServicio(
      'Mapas Bogotá',
      datos.message ?? 'La API de Mapas Bogotá no devolvió rutas para esos puntos.',
      502,
      datos,
    );
  }

  return caminos.map((camino, indice) => {
    const coordenadas = camino.points?.coordinates ?? [];
    const geometria: LatLng[] = coordenadas.map(([lon, lat]) => [lat, lon]);
    if (geometria.length < 2) {
      throw new ErrorServicio('Mapas Bogotá', 'Una ruta llegó sin geometría válida.', 502);
    }

    const pasos = (camino.instructions ?? []).map((inst) => {
      const calle = inst.street_name?.trim();
      let texto = inst.text?.trim() || 'Continúa';
      if (calle && !texto.toLowerCase().includes(calle.toLowerCase())) {
        texto = `${texto} por ${calle}`;
      }
      return {
        instruccion: texto,
        distanciaM: inst.distance ?? 0,
        duracionS: (inst.time ?? 0) / 1000,
        calle: calle || undefined,
      };
    });

    const distanciaM = camino.distance || longitudRuta(geometria);
    const duracionS = (camino.time ?? 0) / 1000;

    return {
      id: `mapas:${indice}:${Math.round(distanciaM)}`,
      perfil: null,
      proveedor: 'mapas' as const,
      proveedorEtiqueta: 'Mapas Bogotá · API de Ruteo',
      perfilMotor: `alternativa ${indice + 1}`,
      distanciaM,
      duracionS,
      ascensoM: camino.ascend,
      geometria,
      pasos,
      advertencias: [
        'Ruta calculada con la API oficial de Mapas Bogotá; puede usar datos y parámetros distintos a OpenStreetMap.',
      ],
      resumen: pasos[0]?.instruccion,
    };
  });
}
