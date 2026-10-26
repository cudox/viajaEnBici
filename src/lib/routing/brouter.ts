import { ENRUTAMIENTO } from '../../config';
import type { LatLng, Lugar, RutaBici } from '../../types';
import { longitudRuta } from '../geo';
import { ErrorServicio, pedirJson } from '../http';

interface BrouterFeature {
  type: 'Feature';
  geometry: { type: 'LineString' | 'MultiLineString'; coordinates: number[][] | number[][][] };
  properties: Record<string, string | number | undefined>;
}

interface BrouterRespuesta {
  type: 'FeatureCollection';
  features: BrouterFeature[];
  error?: string;
}

function coordenadas(feature: BrouterFeature): LatLng[] {
  const g = feature.geometry;
  if (g.type === 'LineString') {
    return (g.coordinates as number[][]).map(([lon, lat]) => [lat, lon]);
  }
  return (g.coordinates as number[][][]).flatMap((line) =>
    line.map(([lon, lat]) => [lat, lon] as LatLng),
  );
}

/**
 * BRouter entrega geometría y totales, pero su formato GeoJSON no incluye
 * instrucciones giro a giro. Se usa como motor alternativo de comparación.
 */
export async function calcularBrouter(
  origen: Lugar,
  destino: Lugar,
  perfil: string,
  signal?: AbortSignal,
): Promise<RutaBici> {
  const params = new URLSearchParams({
    lonlats: `${origen.lon},${origen.lat}|${destino.lon},${destino.lat}`,
    profile: perfil,
    alternativeidx: '0',
    format: 'geojson',
  });
  const datos = await pedirJson<BrouterRespuesta>(`${ENRUTAMIENTO.brouter}?${params}`, {
    tiempoMaximoMs: ENRUTAMIENTO.tiempoMaximoMs,
    signal,
  });

  const feature = datos.features?.[0];
  if (!feature) throw new ErrorServicio('BRouter', 'BRouter no devolvió una ruta.', 502);

  const geometria = coordenadas(feature);
  if (geometria.length < 2) {
    throw new ErrorServicio('BRouter', 'La ruta de BRouter no tiene geometría suficiente.', 502);
  }

  const props = feature.properties ?? {};
  const distanciaM = Number(props['track-length'] ?? 0) || longitudRuta(geometria);
  const duracionS = Number(props['total-time'] ?? 0);
  const ascensoM = Number(props['filtered ascend'] ?? props['plain-ascend'] ?? 0) || undefined;

  return {
    id: `brouter:${perfil}:${Math.round(distanciaM)}`,
    perfil: null,
    proveedor: 'brouter',
    proveedorEtiqueta: `BRouter · ${perfil}`,
    perfilMotor: perfil,
    distanciaM,
    duracionS,
    ascensoM,
    geometria,
    pasos: [
      {
        instruccion: `Sigue la ruta de BRouter (perfil ${perfil})`,
        distanciaM,
        duracionS,
      },
      {
        instruccion: 'Llegaste a tu destino',
        distanciaM: 0,
        duracionS: 0,
      },
    ],
    advertencias: [
      'BRouter no entrega instrucciones giro a giro en GeoJSON; se muestran el trazado y los totales.',
    ],
  };
}
