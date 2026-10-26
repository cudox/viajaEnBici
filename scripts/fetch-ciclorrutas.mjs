#!/usr/bin/env node
/**
 * Descarga la capa oficial de ciclorrutas de Bogotá desde el servicio REST
 * del Mapa de Referencia (IDU / Catastro Bogotá) y la guarda como GeoJSON.
 *
 * Fuente:
 * https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/18
 *
 * Uso: node scripts/fetch-ciclorrutas.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAYER =
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/18';
const PAGE = 1000;
const OUT = resolve(ROOT, 'public/data/ciclorrutas.geojson');
const META = resolve(ROOT, 'public/data/ciclorrutas.meta.json');
const UA = 'viajaEnBici/0.1 (datos abiertos; uso local)';

async function getJson(url, { retries = 3 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const json = await res.json();
      if (json.error) throw new Error(`ArcGIS: ${JSON.stringify(json.error)}`);
      return json;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last;
}

function roundCoords(value, decimals = 5) {
  if (typeof value[0] === 'number') {
    return [Number(value[0].toFixed(decimals)), Number(value[1].toFixed(decimals))];
  }
  return value.map((part) => roundCoords(part, decimals));
}

async function main() {
  console.log('· Leyendo metadatos de la capa oficial…');
  const meta = await getJson(`${LAYER}?f=json`);
  const domain = meta.fields?.find((f) => f.name === 'CICTSUPERF')?.domain?.codedValues ?? [];
  const surfaceNames = Object.fromEntries(domain.map((d) => [d.code, d.name]));
  console.log(`  capa: ${meta.name} (${meta.geometryType}), campos: ${meta.fields.length}`);

  const features = [];
  let offset = 0;
  let bbox = [Infinity, Infinity, -Infinity, -Infinity];

  while (true) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'CICCODIGO,CICCIV,CICTSUPERF',
      returnGeometry: 'true',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: 'geojson',
    });
    const page = await getJson(`${LAYER}/query?${params}`);
    const batch = page.features ?? [];
    if (!batch.length) break;

    for (const f of batch) {
      const p = f.properties ?? {};
      const surface = p.CICTSUPERF ?? p.CicTSuperf ?? null;
      features.push({
        type: 'Feature',
        properties: {
          codigo: p.CICCODIGO ?? p.CicCodigo ?? null,
          civ: p.CICCIV ?? p.CicCIV ?? null,
          superficie: surface,
          superficieNombre: surfaceNames[surface] ?? 'Sin dato',
        },
        geometry: {
          type: f.geometry.type,
          coordinates: roundCoords(f.geometry.coordinates),
        },
      });
      const walk = (c) => {
        if (typeof c[0] === 'number') {
          bbox = [
            Math.min(bbox[0], c[0]),
            Math.min(bbox[1], c[1]),
            Math.max(bbox[2], c[0]),
            Math.max(bbox[3], c[1]),
          ];
        } else c.forEach(walk);
      };
      walk(f.geometry.coordinates);
    }

    offset += batch.length;
    console.log(`  ${offset} features…`);
    if (batch.length < PAGE) break;
    await new Promise((r) => setTimeout(r, 350));
  }

  if (!features.length) throw new Error('La capa no devolvió geometrías.');

  const fc = {
    type: 'FeatureCollection',
    name: 'Ciclorruta Bogotá D.C.',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    metadata: {
      fuente:
        'Instituto de Desarrollo Urbano (IDU) / Unidad Administrativa Especial de Catastro Distrital — Mapa de Referencia',
      servicio: LAYER,
      licencia: 'Consultar términos de uso en datosabiertos.bogota.gov.co',
      descargado: new Date().toISOString(),
      camposSuperficie: surfaceNames,
    },
    features,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(fc));
  await writeFile(
    META,
    JSON.stringify(
      {
        fuente: fc.metadata.fuente,
        servicio: LAYER,
        descargado: fc.metadata.descargado,
        features: features.length,
        bbox: bbox.map((n) => Number(n.toFixed(6))),
        superficies: surfaceNames,
        bytes: (await import('node:fs')).statSync(OUT).size,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`✓ ${features.length} ciclorrutas → ${OUT}`);
  console.log(`  bbox: ${bbox.map((n) => n.toFixed(4)).join(', ')}`);
}

main().catch((err) => {
  console.error('✗ No se pudo descargar la capa:', err.message);
  process.exit(1);
});
