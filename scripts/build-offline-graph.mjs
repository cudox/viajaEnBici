#!/usr/bin/env node
/**
 * Construye los datos sin conexión de viajaEnBici a partir de una descarga de
 * OpenStreetMap (Overpass API, `out geom`):
 *
 *   public/data/grafo-bogota.json.gz.bin   grafo ciclable gzip para enrutamiento local
 *   public/data/base-bogota.geojson    mapa base vectorial esquemático
 *
 * El grafo conserva nodos y aristas, no geometrías completas de OSM. Las
 * aristas se deduplican y el resultado se comprime con gzip.
 *
 * Uso: node scripts/build-offline-graph.mjs [ruta-osm.json]
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = resolve(ROOT, process.argv[2] ?? 'data/fuentes/osm-bogota.json');
const OUT_GRAPH = resolve(ROOT, 'public/data/grafo-bogota.json.gz.bin');
const OUT_META = resolve(ROOT, 'public/data/grafo-bogota.meta.json');
const OUT_BASE = resolve(ROOT, 'public/data/base-bogota.geojson');

const UA = 'viajaEnBici/0.1 (datos abiertos; uso local)';

/** Clases ciclistas: velocidad media (km/h) y estrés relativo (1 = seguro). */
const CLASSES = [
  { id: 'ciclorruta', v: 18, s: 1.0 },
  { id: 'camino', v: 12, s: 1.8 },
  { id: 'peatonal', v: 9, s: 2.2 },
  { id: 'residencial', v: 16, s: 3.0 },
  { id: 'servicio', v: 12, s: 3.6 },
  { id: 'otra', v: 14, s: 4.0 },
  { id: 'terciaria', v: 16, s: 4.5 },
  { id: 'secundaria', v: 18, s: 6.0 },
  { id: 'primaria', v: 17, s: 8.0 },
  { id: 'troncal', v: 20, s: 9.5 },
];
const CLASS_INDEX = new Map(CLASSES.map((c, i) => [c.id, i]));

const BASE_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'cycleway',
  'path',
]);
const BASE_WIDTH = {
  motorway: 20,
  trunk: 20,
  primary: 26,
  secondary: 32,
  tertiary: 42,
  cycleway: 34,
  path: 34,
};

function haversine(a, b) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function classify(tags) {
  const h = tags.highway ?? '';
  const bikeInfra = tags.cycleway && tags.cycleway !== 'no';
  if (h === 'cycleway') return { id: 'ciclorruta', bikeInfra: true };
  if (h === 'path' || h === 'track') return { id: 'camino', bikeInfra };
  if (h === 'footway' || h === 'pedestrian') return { id: 'peatonal', bikeInfra };
  if (h === 'residential' || h === 'living_street') return { id: 'residencial', bikeInfra };
  if (h === 'service') return { id: 'servicio', bikeInfra };
  if (h.startsWith('tertiary')) return { id: 'terciaria', bikeInfra };
  if (h.startsWith('secondary')) return { id: 'secundaria', bikeInfra };
  if (h.startsWith('primary')) return { id: 'primaria', bikeInfra };
  if (h.startsWith('trunk')) return { id: 'troncal', bikeInfra };
  return { id: 'otra', bikeInfra };
}

function isUnpaved(surface = '') {
  return /unpaved|gravel|dirt|ground|earth|grass|compacted|cobblestone|sett|paving_stones|wood|sand/i.test(
    surface,
  );
}

function bikeAllowed(tags) {
  if (tags.bicycle === 'no' || tags.bicycle === 'private') return false;
  if (tags.bicycle === 'dismount') return false;
  if (tags.access === 'private' || tags.access === 'no') return false;
  if (tags.area === 'yes') return false;
  if (tags.highway === 'footway' || tags.highway === 'pedestrian') {
    return ['yes', 'designated', 'permissive'].includes(tags.bicycle);
  }
  if (tags.highway === 'service' && tags.service === 'parking_aisle') return false;
  return true;
}

function onewayBits(tags) {
  if (tags['oneway:bicycle'] === 'no' || tags.cycleway === 'opposite') return 3;
  if (tags.oneway === '-1') return 2;
  if (tags.oneway === 'yes' || tags.oneway === 'true' || tags.oneway === '1') return 1;
  if (tags.junction === 'roundabout') return 1;
  return 3;
}

/** Douglas-Peucker simple sobre coordenadas [lon, lat]. */
function simplify(points, epsilon) {
  if (points.length <= 2) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  let maxD = 0;
  let index = 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const norm = Math.hypot(dx, dy) || 1e-12;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / norm;
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

function round(n, d = 6) {
  return Number(n.toFixed(d));
}

async function main() {
  let raw;
  try {
    raw = JSON.parse(await readFile(INPUT, 'utf8'));
  } catch (err) {
    console.error(`✗ No se pudo leer ${INPUT}: ${err.message}`);
    console.error('  Ejecuta primero: npm run data:osm');
    process.exit(1);
  }
  const ways = raw.elements?.filter((e) => e.type === 'way' && e.geometry?.length > 1) ?? [];
  if (!ways.length) throw new Error('El archivo OSM no contiene ways con geometría.');
  console.log(`· ${ways.length} ways de OSM; construyendo grafo…`);

  const nodeIndex = new Map(); // OSM node id -> índice local
  const nodes = []; // [{lat, lon}]
  const names = [];
  const nameIndex = new Map();
  const edges = [];
  const baseFeatures = [];

  function internName(name) {
    if (!name) return -1;
    let i = nameIndex.get(name);
    if (i === undefined) {
      i = names.length;
      names.push(name);
      nameIndex.set(name, i);
    }
    return i;
  }

  function nodeFor(osmId, point) {
    let idx = nodeIndex.get(osmId);
    if (idx === undefined) {
      idx = nodes.length;
      nodes.push({ lat: round(point.lat, 6), lon: round(point.lon, 6) });
      nodeIndex.set(osmId, idx);
    }
    return idx;
  }

  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!tags.highway || !bikeAllowed(tags)) continue;
    const pts = way.geometry;
    const ids = way.nodes;
    if (!ids || ids.length !== pts.length) continue;

    const cls = classify(tags);
    const clsIdx = CLASS_INDEX.get(cls.id) ?? CLASS_INDEX.get('otra');
    const unpaved = isUnpaved(tags.surface);
    const name = tags.name ?? tags.ref ?? '';
    const nameIdx = internName(name);

    // Velocidad y seguridad locales a la arista.
    const clsDef = CLASSES[clsIdx];
    let speed = clsDef.v;
    let safety = clsDef.s;
    if (cls.bikeInfra) safety = Math.max(0.8, safety - 1.2);
    if (tags.bicycle === 'designated' || tags.bicycle === 'yes') safety -= 0.4;
    if (unpaved) {
      speed *= 0.65;
      safety += 0.8;
    }
    if (/^(bad|very_bad|horrible)$/.test(tags.smoothness ?? '')) speed *= 0.75;
    const maxspeed = Number(String(tags.maxspeed ?? '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(maxspeed) && maxspeed > 30) {
      safety += Math.min(3, (maxspeed - 30) / 25);
    }
    safety = Math.max(0.6, safety);
    const bits = onewayBits(tags);

    // La dirección se normaliza invirtiendo la geometría si oneway=-1.
    const reverse = bits === 2;
    const orderedPts = reverse ? [...pts].reverse() : pts;
    const orderedIds = reverse ? [...ids].reverse() : ids;

    let prevIdx = nodeFor(orderedIds[0], orderedPts[0]);
    for (let i = 1; i < orderedPts.length; i++) {
      const curIdx = nodeFor(orderedIds[i], orderedPts[i]);
      if (curIdx === prevIdx) continue;
      const length = haversine(orderedPts[i - 1], orderedPts[i]);
      if (length < 0.5) {
        prevIdx = curIdx;
        continue;
      }
      edges.push({
        a: prevIdx,
        b: curIdx,
        len: Math.max(0.5, Math.round(length * 10) / 10),
        cls: clsIdx,
        name: nameIdx,
        bits: reverse ? 3 : bits,
        speed,
        safety,
      });
      prevIdx = curIdx;
    }

    // Mapa base: solo vías estructurantes y ciclorrutas.
    if (BASE_CLASSES.has(tags.highway)) {
      const coords = pts.map((p) => [round(p.lon, 5), round(p.lat, 5)]);
      const simplified = simplify(coords, 0.000025);
      baseFeatures.push({
        type: 'Feature',
        properties: {
          c: tags.highway,
          n: name || undefined,
          w: BASE_WIDTH[tags.highway] ?? 40,
        },
        geometry: { type: 'LineString', coordinates: simplified },
      });
    }
  }

  console.log(`  nodos: ${nodes.length}, aristas: ${edges.length}`);

  // Deduplicar por par de nodos, conservando la mejor seguridad y uniendo sentidos.
  const merged = new Map();
  for (const e of edges) {
    const swap = e.a > e.b;
    const a = swap ? e.b : e.a;
    const b = swap ? e.a : e.b;
    let bits = e.bits;
    if (swap) bits = ((bits & 1) ? 2 : 0) | ((bits & 2) ? 1 : 0);
    const key = `${a}|${b}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...e, a, b, bits });
    } else {
      prev.bits |= bits;
      if (e.safety < prev.safety || (e.safety === prev.safety && e.len < prev.len)) {
        prev.len = e.len;
        prev.cls = e.cls;
        prev.name = e.name;
        prev.speed = e.speed;
        prev.safety = e.safety;
      }
    }
  }
  const finalEdges = [...merged.values()];
  console.log(`  aristas tras deduplicar: ${finalEdges.length}`);

  // Componente conectada principal (solo para diagnóstico y snapping).
  const parent = new Int32Array(nodes.length).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const e of finalEdges) union(e.a, e.b);
  const comps = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i);
    comps.set(r, (comps.get(r) ?? 0) + 1);
  }
  const largest = Math.max(...comps.values());
  console.log(
    `  componentes: ${comps.size}; mayor: ${largest} nodos (${((largest / nodes.length) * 100).toFixed(1)}%)`,
  );

  // Redondear parámetros por clase para el archivo final.
  const classTable = CLASSES.map((c) => ({ id: c.id, v: c.v, s: c.s }));

  const graphBbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const n of nodes) {
    graphBbox[0] = Math.min(graphBbox[0], n.lon);
    graphBbox[1] = Math.min(graphBbox[1], n.lat);
    graphBbox[2] = Math.max(graphBbox[2], n.lon);
    graphBbox[3] = Math.max(graphBbox[3], n.lat);
  }

  const graph = {
    version: 1,
    generado: new Date().toISOString(),
    fuente: '© OpenStreetMap contributors (ODbL 1.0)',
    bbox: graphBbox.map((n) => round(n, 5)),
    clases: classTable,
    nombres: names,
    nodos: nodes.map((n) => [n.lat, n.lon]),
    aristas: finalEdges.map((e) => [
      e.a,
      e.b,
      e.len,
      e.cls,
      e.name,
      e.bits,
      Math.round(e.speed * 10) / 10,
      Math.round(e.safety * 100) / 100,
    ]),
  };

  const json = JSON.stringify(graph);
  await writeFile(OUT_GRAPH, gzipSync(Buffer.from(json), { level: 9 }));

  const base = {
    type: 'FeatureCollection',
    name: 'Mapa base esquemático de Bogotá (OSM)',
    metadata: {
      fuente: '© OpenStreetMap contributors',
      licencia: 'ODbL 1.0',
      generado: new Date().toISOString(),
    },
    features: baseFeatures,
  };
  await writeFile(OUT_BASE, JSON.stringify(base));

  const graphBytes = (await stat(OUT_GRAPH)).size;
  const baseBytes = (await stat(OUT_BASE)).size;
  await writeFile(
    OUT_META,
    JSON.stringify(
      {
        version: 1,
        generado: graph.generado,
        fuente: graph.fuente,
        bbox: graph.bbox,
        nodos: nodes.length,
        aristas: finalEdges.length,
        componentes: comps.size,
        mayorComponente: largest,
        bytesGrafo: graphBytes,
        bytesMapaBase: baseBytes,
        clases: classTable,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`✓ grafo: ${(graphBytes / 1024 / 1024).toFixed(2)} MB gzip → ${OUT_GRAPH}`);
  console.log(`✓ mapa base: ${(baseBytes / 1024 / 1024).toFixed(2)} MB → ${OUT_BASE}`);
}

main().catch((err) => {
  console.error('✗ Error construyendo datos offline:', err);
  process.exit(1);
});
