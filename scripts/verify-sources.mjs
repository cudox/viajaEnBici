#!/usr/bin/env node
/**
 * Comprueba las fuentes reales que usa viajaEnBici. No usa claves ni endpoints
 * inventados: cada prueba hace una petición pequeña y muestra el resultado.
 *
 * Uso: node scripts/verify-sources.mjs
 * Sale con código 1 si falla una fuente crítica.
 */
const ORIGEN = 'http://localhost:4173';
const UA = 'viajaEnBici/0.1 (verificación de fuentes; uso local)';
const resultados = [];

async function pedir(url, opciones = {}) {
  const { sinUa = false, sinOrigen = false, ...resto } = opciones;
  const headers = { ...(resto.headers ?? {}) };
  if (!sinUa) headers['User-Agent'] = UA;
  if (!sinOrigen) headers.Origin = ORIGEN;
  const respuesta = await fetch(url, {
    ...resto,
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  const tipo = respuesta.headers.get('content-type') ?? '';
  const cuerpo = tipo.includes('json') || tipo.includes('geo+json')
    ? await respuesta.json()
    : await respuesta.text();
  return { respuesta, tipo, cuerpo };
}

async function probar(nombre, critico, fn) {
  const inicio = Date.now();
  try {
    const detalle = await fn();
    const ms = Date.now() - inicio;
    resultados.push({ nombre, ok: true, detalle, ms });
    console.log(`✓ ${nombre} (${ms} ms): ${detalle}`);
  } catch (error) {
    const ms = Date.now() - inicio;
    const detalle = error instanceof Error ? error.message : String(error);
    resultados.push({ nombre, ok: false, detalle, ms, critico });
    console.log(`${critico ? '✗' : '!'} ${nombre} (${ms} ms): ${detalle}`);
  }
}

const ORIGEN_BICI = { lat: 4.6767, lon: -74.0483 };
const DESTINO_BICI = { lat: 4.5981, lon: -74.076 };

await probar('Valhalla FOSSGIS · ruteo bici', true, async () => {
  const { respuesta, cuerpo } = await pedir('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [ORIGEN_BICI, DESTINO_BICI],
      costing: 'bicycle',
      directions_options: { units: 'kilometers', language: 'es-ES' },
    }),
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const resumen = cuerpo?.trip?.summary;
  if (!resumen) throw new Error(`sin trip.summary: ${JSON.stringify(cuerpo).slice(0, 160)}`);
  const cors = respuesta.headers.get('access-control-allow-origin') ?? 'sin CORS';
  const maniobra = cuerpo?.trip?.legs?.[0]?.maneuvers?.[0]?.instruction ?? 'sin instrucción';
  return `${(resumen.length).toFixed(1)} km, ${Math.round(resumen.time / 60)} min · ${maniobra} · CORS ${cors}`;
});

await probar('BRouter · GeoJSON fastbike', true, async () => {
  const url = new URL('https://brouter.de/brouter');
  url.search = new URLSearchParams({
    lonlats: `${ORIGEN_BICI.lon},${ORIGEN_BICI.lat}|${DESTINO_BICI.lon},${DESTINO_BICI.lat}`,
    profile: 'fastbike',
    alternativeidx: '0',
    format: 'geojson',
  }).toString();
  const { respuesta, cuerpo } = await pedir(url);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const feature = cuerpo?.features?.[0];
  if (!feature) throw new Error('sin features');
  const metros = Number(feature.properties['track-length']);
  const segundos = Number(feature.properties['total-time']);
  const cors = respuesta.headers.get('access-control-allow-origin') ?? 'sin CORS';
  return `${(metros / 1000).toFixed(2)} km, ${Math.round(segundos / 60)} min · ${feature.geometry.type} · CORS ${cors}`;
});

await probar('Mapas Bogotá · API de Ruteo', true, async () => {
  const url = new URL('https://catalogopmb.catastrobogota.gov.co/PMBWeb/web/ruteo');
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
  params.append('point', `${ORIGEN_BICI.lat},${ORIGEN_BICI.lon}`);
  params.append('point', `${DESTINO_BICI.lat},${DESTINO_BICI.lon}`);
  url.search = params.toString();
  const { respuesta, cuerpo } = await pedir(url);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const camino = cuerpo?.response?.paths?.[0];
  if (!camino) throw new Error(`sin response.paths: ${JSON.stringify(cuerpo).slice(0, 180)}`);
  const cors = respuesta.headers.get('access-control-allow-origin') ?? 'sin CORS';
  return `${(camino.distance / 1000).toFixed(2)} km, ${Math.round(camino.time / 60000)} min, ${camino.instructions?.length ?? 0} instrucciones · CORS ${cors}`;
});

await probar('Nominatim · búsqueda', true, async () => {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: 'Plaza de Bolívar, Bogotá',
    format: 'jsonv2',
    limit: '2',
    countrycodes: 'co',
    'accept-language': 'es',
  }).toString();
  const { respuesta, cuerpo } = await pedir(url);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  if (!Array.isArray(cuerpo) || !cuerpo.length) throw new Error('sin resultados');
  const cors = respuesta.headers.get('access-control-allow-origin') ?? 'sin CORS';
  return `${cuerpo.length} resultados · ${cuerpo[0].display_name.slice(0, 70)}… · CORS ${cors}`;
});

await probar('ArcGIS · capa oficial de ciclorrutas', true, async () => {
  const { respuesta, cuerpo } = await pedir(
    'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/18?f=json',
    { sinUa: true },
  );
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  if (cuerpo?.error) throw new Error(JSON.stringify(cuerpo.error));
  const campo = cuerpo.fields?.find((f) => f.name === 'CICTSUPERF');
  return `${cuerpo.name ?? 'capa'} · ${cuerpo.geometryType} · superficie=${Boolean(campo)} · CORS ${respuesta.headers.get('access-control-allow-origin') ?? 'sin CORS'}`;
});

await probar('IDECA · tesela del mapa base', true, async () => {
  const { respuesta, tipo } = await pedir(
    'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/mapa_base_3857/MapServer/tile/12/1995/1205',
    { sinUa: true },
  );
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  if (!tipo.startsWith('image/')) throw new Error(`tipo inesperado: ${tipo}`);
  return `tesela 12/1995/1205 · ${tipo}`;
});

await probar('Overpass · consulta pequeña', true, async () => {
  const consulta = '[out:json][timeout:25];node(4.6,-74.1,4.601,-74.099);out 3;';
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const { respuesta, cuerpo } = await pedir('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams({ data: consulta }),
      });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      if (!Array.isArray(cuerpo?.elements)) throw new Error('respuesta sin elements');
      return `${cuerpo.elements.length} elementos (intento ${intento}) · CORS ${respuesta.headers.get('access-control-allow-origin') ?? 'sin CORS'}`;
    } catch (error) {
      ultimoError = error;
      if (intento < 3) await new Promise((r) => setTimeout(r, 2500 * intento));
    }
  }
  throw ultimoError;
});

// Comprobación no crítica: documenta el estado real de un endpoint alternativo.
await probar('Mapas Bogotá · /buscar2 (no integrado)', false, async () => {
  const url = new URL('https://catalogopmb.catastrobogota.gov.co/PMBWeb/web/buscar2');
  url.search = new URLSearchParams({
    q: 'Plaza de Bolívar',
    boundingBox: '-74.25,4.45,-73.95,4.85',
    distance: '1000',
    lat: '4.6',
    lng: '-74.1',
    page: '0',
    size: '5',
  }).toString();
  const { respuesta, cuerpo } = await pedir(url);
  return `HTTP ${respuesta.status} · ${JSON.stringify(cuerpo).slice(0, 180)}`;
});

const criticosFallidos = resultados.filter((r) => !r.ok && r.critico);
console.log('');
console.log(
  `Resumen: ${resultados.filter((r) => r.ok).length}/${resultados.length} pruebas correctas; ${criticosFallidos.length} fallos críticos.`,
);
if (criticosFallidos.length) {
  console.error('Fuentes críticas con fallo:', criticosFallidos.map((r) => r.nombre).join(', '));
  process.exit(1);
}
