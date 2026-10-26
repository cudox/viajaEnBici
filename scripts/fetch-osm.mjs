#!/usr/bin/env node
/**
 * Descarga la red ciclable de Bogotá desde Overpass API en formato JSON
 * (`out geom`) para construir el grafo sin conexión.
 *
 * Uso:
 *   node scripts/fetch-osm.mjs            # reutiliza la descarga si existe
 *   node scripts/fetch-osm.mjs --forzar   # vuelve a descargar
 *
 * El archivo crudo (≈77 MB) queda en data/fuentes/ y está ignorado por Git.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/fuentes/osm-bogota.json');
const META = resolve(ROOT, 'data/fuentes/osm-bogota.meta.json');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const UA = 'viajaEnBici/0.1 (datos abiertos; uso local)';

// BBox: sur,oeste,norte,este. Incluye la red ciclable y vías urbanas de Bogotá.
const BBOX = '4.48,-74.22,4.83,-74.01';
const HIGHWAYS =
  'cycleway|path|track|footway|pedestrian|living_street|residential|unclassified|service|tertiary(_link)?|secondary(_link)?|primary(_link)?|trunk(_link)?';
const QUERY = `[out:json][timeout:240];
(
  way["highway"~"^(${HIGHWAYS})$"]["bicycle"!="no"]["access"!="private"](${BBOX});
);
out geom;`;

async function existe(ruta) {
  try {
    const info = await stat(ruta);
    return info.size > 1_000_000;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const forzar = process.argv.includes('--forzar');

  if (!forzar && (await existe(OUT))) {
    console.log(`· Reutilizando ${OUT}`);
  } else {
    console.log(`· Consultando Overpass (${ENDPOINT})…`);
    const inicio = Date.now();
    let texto = '';
    let ultimoError;
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const respuesta = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': UA,
          },
          body: new URLSearchParams({ data: QUERY }),
          signal: AbortSignal.timeout(300_000),
        });
        if (!respuesta.ok) {
          const cuerpo = await respuesta.text().catch(() => '');
          throw new Error(`Overpass HTTP ${respuesta.status}: ${cuerpo.slice(0, 300)}`);
        }
        texto = await respuesta.text();
        break;
      } catch (error) {
        ultimoError = error;
        if (intento < 3) {
          console.log(`  intento ${intento} falló; reintentando en ${intento * 3} s…`);
          await new Promise((r) => setTimeout(r, 3000 * intento));
        }
      }
    }
    if (!texto) throw ultimoError ?? new Error('Overpass no devolvió datos.');
    let json;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error(`Overpass no devolvió JSON: ${texto.slice(0, 300)}`);
    }
    if (!Array.isArray(json.elements)) {
      throw new Error(`Respuesta inesperada de Overpass: ${texto.slice(0, 300)}`);
    }
    await writeFile(OUT, texto);
    await writeFile(
      META,
      JSON.stringify(
        {
          fuente: '© OpenStreetMap contributors (ODbL 1.0)',
          endpoint: ENDPOINT,
          consulta: QUERY,
          bbox: BBOX,
          descargado: new Date().toISOString(),
          duracionS: Math.round((Date.now() - inicio) / 1000),
          elementos: json.elements.length,
          bytes: Buffer.byteLength(texto),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`✓ ${json.elements.length.toLocaleString('es-CO')} elementos → ${OUT}`);
  }

  const texto = await readFile(OUT, 'utf8');
  const json = JSON.parse(texto);
  const ways = json.elements.filter((elemento) => elemento.type === 'way');
  console.log(`✓ JSON válido: ${ways.length.toLocaleString('es-CO')} ways, ${(texto.length / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((error) => {
  console.error('✗ Error descargando OSM:', error);
  process.exit(1);
});
