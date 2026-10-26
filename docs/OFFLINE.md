# Modo sin conexión

## Qué significa «offline real» aquí

No es solo guardar las teselas del mapa ni una respuesta anterior. La app incluye:

1. un **grafo ciclable** construido desde OpenStreetMap;
2. un **mapa base vectorial** local;
3. la capa oficial de **ciclorrutas**;
4. un **motor Dijkstra** que corre en un Web Worker;
5. un **service worker** que conserva el armazón y los datos.

Con la red desactivada se puede recargar la aplicación, abrir el mapa vectorial y calcular tres rutas nuevas entre dos puntos, sin consultar ningún servidor.

## Archivos empaquetados

| Archivo | Contenido | Tamaño |
| --- | --- | ---: |
| `public/data/grafo-bogota.json.gz.bin` | nodos, aristas, clases, nombres, velocidades y estrés | 4,62 MB |
| `public/data/grafo-bogota.meta.json` | metadatos y conteos del grafo | 1 KB |
| `public/data/base-bogota.geojson` | vías estructurantes y ciclorrutas para dibujar | 3,56 MB |
| `public/data/ciclorrutas.geojson` | 6.311 polígonos oficiales | 3,8 MB |
| `public/data/ciclorrutas.meta.json` | fuente, fecha, bbox y superficies | 580 B |

El total de datos es de unos **12 MB**. El APK debug pesa **12 MB**.

La extensión final `.bin` es deliberada. Android Asset Packaging Tool trata los archivos `.gz` de forma especial y puede quitarles la extensión al empaquetar; al llamarse `.json.gz.bin`, el nombre se conserva y la app sabe que debe descomprimir gzip. En la web también funciona porque `DecompressionStream` se encarga del contenido, no de la extensión.

## Preparación en la web

1. Abre la app con conexión.
2. Pulsa **Preparar datos** en la caja «Modo sin conexión».
3. Espera a que el chip muestre **Listo · 8/8**.
4. Corta la red y recarga.

El botón guarda en `Cache Storage`:

- los ocho archivos de datos;
- el documento `index.html` y `./`;
- el JavaScript y el CSS con hash que referencia el documento;
- el manifest y los iconos.

El service worker también precarga el armazón al instalarse. Así una recarga funciona aunque la primera visita no haya sido controlada por el service worker.

En Android los datos ya están dentro del APK (`assets/public/`), por lo que no hace falta descargarlos. El botón sigue siendo útil si se quiere copiar todo a `Cache Storage` y probar el mismo flujo.

## Uso

La caja «Modo sin conexión» ofrece tres comportamientos:

| Opción | Comportamiento |
| --- | --- |
| Automático (sin red) | usa los motores en línea si hay red; si falla todo, cae al motor local |
| Siempre sin conexión | calcula directamente con el grafo local |
| Solo en línea | no usa el motor local como respaldo |

También hay un botón **Probar motor local** que precarga el grafo y, si ya hay origen y destino, calcula la comparación offline al momento.

## Grafo

El generador (`scripts/build-offline-graph.mjs`) parte de una descarga de Overpass con `out geom` y:

- filtra vías sin `highway` o con `bicycle=no/private`, `access=private/no`, áreas y senderos peatonales no autorizados;
- clasifica en ciclorruta, camino, peatonal, residencial, servicio, terciaria, secundaria, primaria, troncal u otra;
- asigna velocidad media y estrés relativo (1 = seguro; 10 = muy estresante);
- ajusta por infraestructura ciclista, superficie no pavimentada, suavidad y `maxspeed`;
- normaliza `oneway` y `oneway:bicycle=no` en bits de dirección;
- deduplica el par de nodos y conserva la mejor seguridad y la unión de sentidos;
- divide en componentes conexas y reporta la mayor.

Resultado de la última generación:

```text
nodos:              320.191
aristas:            358.236
componentes:        365
mayor componente:   315.365 nodos (98,5 %)
gzip:               4,62 MB
descomprimido:      19.216.646 bytes
```

La mayor componente cubre la práctica totalidad de la ciudad. Si un punto cae en una componente pequeña, el motor puede responder que no hay ruta.

## Algoritmo

En `src/lib/routing/offline-graph.ts`:

- índice espacial en celdas de 0,0025°;
- snapping al nodo más cercano, con límite de **400 m**;
- lista de adyacencia con `Int32Array`;
- cola de prioridad binaria;
- Dijkstra con el coste del perfil:
  - `rapida`: `longitud / (velocidad / 3,6)`;
  - `corta`: `longitud`;
  - `segura`: `longitud × estrés`;
- reconstrucción de la ruta y agrupación de tramos por nombre y clase;
- instrucciones con rumbo inicial y giros («gira a la derecha», «continúa», «gira en U»).

El worker recibe el grafo una vez y conserva el índice. Las tres rutas se calculan en la misma sesión; en la prueba real tardaron **0,5 s** después de cargar el grafo.

## Service worker

`public/sw.js` (caché `viajaenbici-v3`):

- **navegación**: red primero; si falla, documento cacheado;
- **`/data/`**: cache primero y revalidación en segundo plano;
- **mismo origen**: cache first;
- **otro origen** (teselas y APIs): no se intercepta;
- **`message CACHE_OFFLINE`**: guarda una lista de archivos desde la página.

No se cachean teselas externas de forma masiva. El mapa sin conexión es el vectorial; las teselas de IDECA necesitan red.

## Verificación real

Prueba hecha con Chrome for Testing 156 headless, perfil nuevo, servidor `vite preview` en `127.0.0.1:4173` y CDP:

1. primera carga: `0/8 archivos`, service worker registrado;
2. búsqueda real de «Plaza de Bolívar»: 1 resultado;
3. comparación en línea: 1,1 s, cinco fuentes, tarjetas 10,1 km/31 min, 9,7 km/33 min y 11,0 km/47 min;
4. **Preparar datos** → **Listo · 8/8**;
5. red desactivada y recarga completa;
6. la app volvió a abrir desde caché, mostró «Sin conexión» y el mapa vectorial;
7. comparación offline: **0,5 s**, tarjetas 9,9 km/34 min, 9,7 km/39 min y 10,3 km/41 min;
8. cuatro trazados en el mapa, un canvas de Leaflet, sin errores de consola al final.

No se probó en un dispositivo Android físico. En Android los archivos están empaquetados, pero la descompresión depende de que el WebView del sistema soporte `DecompressionStream` (Chrome/WebView moderno).

## Actualizar los datos

```bash
# 1. Descargar OSM (reutiliza data/fuentes/osm-bogota.json si existe)
npm run data:osm

# 2. Reconstruir grafo y mapa base
npm run data:offline

# 3. Descargar de nuevo la capa de ciclorrutas
npm run data:ciclorrutas

# 4. Recompilar y sincronizar Android
npm run build
npx cap sync android
```

Si cambian los datos, sube la versión de `CACHE.nombre` en `src/config.ts` y de `VERSION` en `public/sw.js`. La activación elimina las cachés antiguas.

## Límites

- Foto estática de OSM; no hay actualización automática.
- Sin tráfico, obras, cierres ni estado actual de ciclorrutas.
- El mapa vectorial es esquemático: no tiene todos los detalles del mapa de IDECA.
- El estrés es una heurística, no una medida de seguridad vial.
- El snapping falla si el punto está a más de 400 m de la red.
- La primera carga del grafo descomprime ~19 MB y construye el índice; puede tardar uno o dos segundos en un teléfono modesto.
- Borrar los datos del sitio o de la app elimina la caché; hay que volver a prepararla.
