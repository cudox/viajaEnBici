# Fuentes, APIs y datos

Todas las URLs de esta página fueron probadas desde CachyOS el **26 de octubre de 2026**. Las pruebas se hicieron con peticiones reales; no se inventaron endpoints ni respuestas. Los resultados pueden cambiar porque varias fuentes son servicios públicos.

## Resumen

| Fuente | Uso en la app | Resultado de la prueba | CORS | Licencia / condiciones |
| --- | --- | --- | --- | --- |
| Valhalla FOSSGIS | rutas rápida, corta y segura | HTTP 200; 10,8 km / 41 min con la consulta base | `*` | Servicio público de demostración; datos OSM |
| BRouter | ruta alternativa `fastbike` | HTTP 200; 9,66 km / 33 min | `*` | Servicio público; datos OSM |
| API de Ruteo de Mapas Bogotá | hasta 3 alternativas e instrucciones | HTTP 200; 9,85 km / 35 min; 21 instrucciones | `*` | Catastro Distrital; revisar términos |
| Nominatim | búsqueda y geocodificación inversa | HTTP 200; 1 resultado para «Plaza de Bolívar» | `*` | OSM; política de uso de 1 req/s |
| ArcGIS REST, capa 18 | ciclorrutas oficiales | HTTP 200; 6.311 polígonos | eco del origen | IDU / Catastro; datos abiertos |
| IDECA `mapa_base_3857` | teselas del mapa claro | HTTP 200; `image/png` | no aplica a `<img>` | IDECA / Catastro |
| IDECA `mapa_base_oscuro_3857` | teselas del mapa oscuro | HTTP 200; `image/png` | no aplica a `<img>` | IDECA / Catastro |
| Overpass API | descarga de la red OSM | consulta pequeña correcta; descarga completa de 123.418 ways | `*` | OSM ODbL 1.0 |

La comprobación automatizada está en `scripts/verify-sources.mjs`:

```bash
npm run verify:fuentes
```

El 26/10/2026 terminó con **8/8 pruebas correctas**. Overpass necesitó tres intentos y tardó 43 s; los demás servicios respondieron en menos de 1 s o alrededor de 15 s en el caso de `/buscar2`.

## Enrutamiento

### Valhalla (FOSSGIS)

- Endpoint usado: `POST https://valhalla1.openstreetmap.de/route`
- Cuerpo: `locations`, `costing: "bicycle"`, `costing_options.bicycle` y `directions_options` en español/kilómetros.
- Respuesta: `trip.summary` y `trip.legs[].maneuvers`; la geometría viene codificada en polyline 6.
- Prueba base: **10,8 km, 41 min**, primera instrucción «Vaya en bicicleta hacia el sureste por Calle 93A.».
- Perfil rápido de la app para el mismo par: **10,1 km, 31 min**.
- Perfil seguro: **11,0 km, 47 min**.
- CORS: `Access-Control-Allow-Origin: *`.
- No se recibió `elevation_gained` en las respuestas probadas; la app lo deja indefinido.

`https://valhalla.openstreetmap.de/route` (sin el subdominio `1`) respondió **405 Method Not Allowed** a una petición POST. Por eso se usa `valhalla1`.

> Es una instancia pública de FOSSGIS. No hay SLA ni cuota contractual. Para producción se debe autohospedar Valhalla o acordar el uso.

### BRouter

- Endpoint: `GET https://brouter.de/brouter`
- Parámetros: `lonlats=lon,lat|lon,lat`, `profile=fastbike`, `alternativeidx=0`, `format=geojson`.
- Prueba: **9,66 km, 33 min**, geometría `LineString`.
- CORS: `*`.
- El GeoJSON no incluye instrucciones giro a giro; solo totales y ascenso. La app lo advierte.
- El perfil `fastbike` prioriza velocidad, no seguridad.

### API de Ruteo de Mapas Bogotá

- Endpoint: `GET https://catalogopmb.catastrobogota.gov.co/PMBWeb/web/ruteo`
- Parámetros usados: `type=json`, `locale=es`, `points_encoded=false`, `elevation=true`, `ch.disable=true`, `algorithm=alternative_route`, `alternative_route.max_paths=3`, `vehicle=bike`, y dos `point=lat,lon`.
- Prueba: **9,85 km, 35 min**, 21 instrucciones; tres alternativas disponibles.
- CORS: `*`.
- La API devuelve `response.paths[]` con `distance` en metros, `time` en milisegundos y `instructions`.
- Si se pide `alternative_route.max_paths=1`, el servidor respondió con un error de GraphHopper: «Use normal algorithm with less overhead instead if no alternatives are required». La app pide 3 alternativas; por eso se usa `max_paths=3`.

#### `/buscar2`: no integrado

Se probó la búsqueda de Mapas Bogotá:

```text
GET https://catalogopmb.catastrobogota.gov.co/PMBWeb/web/buscar2
  ?q=Plaza de Bolívar
  &boundingBox=-74.25,4.45,-73.95,4.85
  &distance=1000&lat=4.6&lng=-74.1&page=0&size=5
```

Respondió **HTTP 200** con `{"status":false}` y sin resultados. No se encontró una combinación de parámetros documentada que devolviera lugares. **No se usa en la app**; la búsqueda se resuelve con Nominatim. Si se quiere integrar en el futuro, hay que obtener la documentación o los parámetros exactos del catálogo y volver a probar.

## Geocodificación

### Nominatim

- Endpoint: `GET https://nominatim.openstreetmap.org/search`
- Parámetros: `q`, `format=jsonv2`, `limit`, `countrycodes=co`, `accept-language=es`.
- Búsqueda probada: «Plaza de Bolívar, Bogotá» → 1 resultado, coordenadas `4.59817, -74.07600`.
- CORS: `*`.
- La app restringe por vista/país, espera 350 ms entre teclas, cancela la petición anterior y cachea resultados.
- Política de Nominatim: máximo aproximado de **1 petición por segundo**, identificarse y no hacer geocodificación masiva. Un navegador no puede fijar un `User-Agent` propio; para producción conviene un proxy o una instancia propia.

## Datos oficiales

### Ciclorrutas

- Servicio: `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/18`
- Metadatos: HTTP 200; nombre `Cicloruta`, `esriGeometryPolygon`.
- Descarga: **6.311 features**, bbox `[-74.211062, 4.480904, -74.022909, 4.819964]`.
- Archivo: `public/data/ciclorrutas.geojson`, **3,8 MB**.
- Campos relevantes: `CICTSUPERF` (superficie) y nombres de vía.
- Superficies: `0 Sin dato`, `1 Concreto`, `2 Asfalto`, `3 Mixtos`, `4 Adoquin concreto`, `5 Adoquin arcilla`.
- Atribución: IDU / Unidad Administrativa Especial de Catastro Distrital, Mapa de Referencia.
- CORS: el servicio devolvió el origen de la petición (`http://localhost:4173`); la app lo consume con `fetch` desde el navegador y funcionó en la prueba.

No se afirma que la capa sea exhaustiva ni que esté actualizada al día. Es la capa oficial publicada por el catálogo en la fecha de descarga.

### Mapa base

- Claro: `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/mapa_base_3857/MapServer/tile/{z}/{y}/{x}`
- Oscuro: `.../mapa_base_oscuro_3857/MapServer/tile/{z}/{y}/{x}`
- Prueba: tesela `12/1995/1205` → HTTP 200, `image/png`, 55.166 bytes.
- Atribución en el mapa: «© IDECA · Catastro Bogotá · OpenStreetMap».
- No requieren clave. Se usan como imágenes de Leaflet; no se cachean masivamente.

Se descartó CARTO porque su servicio de teselas mostró «API KEY REQUIRED» sin una clave. No se usa ninguna credencial en la app.

## Datos offline

### OpenStreetMap / Overpass

- Consulta: `way["highway"~"^(cycleway|path|track|footway|pedestrian|living_street|residential|unclassified|service|tertiary(_link)?|secondary(_link)?|primary(_link)?|trunk(_link)?)$"]["bicycle"!="no"]["access"!="private"](4.48,-74.22,4.83,-74.01); out geom;`
- Endpoint: `POST https://overpass-api.de/api/interpreter`
- Descarga completa: **123.418 ways**, archivo crudo de **76,8 MB**.
- Grafo resultante: **320.191 nodos, 358.236 aristas, 365 componentes**, la mayor con **315.365 nodos (98,5 %)**.
- Grafo comprimido: **4,62 MB** (`public/data/grafo-bogota.json.gz.bin`).
- Mapa base vectorial: **3,56 MB** (`public/data/base-bogota.geojson`).
- Licencia: © colaboradores de OpenStreetMap, **ODbL 1.0**. La atribución aparece en la app y en este repositorio.

La consulta pequeña de verificación (`node(4.6,-74.1,4.601,-74.099); out 3;`) respondió correctamente tras tres intentos; Overpass puede devolver 504 por cola o sobrecarga. El script de descarga reintenta tres veces con espera.

## Atribución y uso

- **OpenStreetMap**: © OpenStreetMap contributors, ODbL 1.0. Cualquier obra derivada de la base de datos debe mantener la atribución y compartir bajo ODbL cuando corresponda.
- **IDECA / Catastro Bogotá**: mapa base y capa de ciclorrutas. Se debe respetar la atribución y los términos del portal de datos abiertos.
- **IDU**: autoridad de los datos de ciclorrutas.
- **Valhalla, BRouter, Nominatim, FOSSGIS y GraphHopper/Mapas Bogotá**: servicios de terceros. No se redistribuyen sus respuestas como datos propios; se usan para calcular rutas bajo demanda.
- **Leaflet**: BSD-2-Clause.

Este repositorio no incluye claves, tokens ni credenciales. Si se despliega a escala, hay que revisar cuotas, autohospedar los motores y actualizar los datos.
