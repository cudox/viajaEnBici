# Pruebas y resultados reales

Fecha de la campaña: **26 de octubre de 2026**. Entorno: CachyOS, Node 26.11.1, npm 12.2.1, Chrome for Testing 156.0.8078.47 y Firefox Developer Edition 159 headless, JDK 21.0.12.1, Android SDK 36.

No se incluyen resultados inventados. Cuando una prueba dependió de un servicio público, se indica la variabilidad observada.

## Automatizadas

```bash
npm test
```

Resultado:

```text
Test Files  5 passed (5)
Tests       32 passed (32)
Duration    775 ms
```

Cobertura de las pruebas:

- `tests/geo.test.ts`: haversine, rumbos, giros, decodificación de una polilínea real de Valhalla y formato español (`10.1 km`, no `10 km`).
- `tests/routing-normalize.test.ts`: normalización de respuestas de los motores.
- `tests/offline-graph.test.ts`: carga el **grafo real** de 320.191 nodos, snapping a los puntos de prueba, rutas con los tres perfiles, instrucciones, límites geográficos y rechazo de puntos a más de 400 m de la red.
- `tests/rutas-guardadas.test.ts`: deduplicación de destinos, límite de 30, actualización de favoritas, límites, datos corruptos y fallback en memoria.
- `tests/storage.test.ts`: preferencias antiguas, modo de origen GPS/manual, sesión y limpieza de claves locales.

La prueba offline no usa un fixture pequeño: descomprime `public/data/grafo-bogota.json.gz.bin` y calcula rutas reales. Por eso tarda más que una prueba unitaria normal.

## Tipos y build

```bash
npm run build
```

Ejecuta `tsc --noEmit` y `vite build`. Resultado: **correcto**. `dist/` contiene el JavaScript/CSS con hash, el service worker y unos 12 MB de datos.

Tamaños relevantes:

```text
dist/assets/index-*.js    ~192 KB
dist/data/grafo...bin      4,62 MB
dist/data/base...geojson   3,56 MB
dist/data/ciclorrutas...   3,8 MB
dist total                 ~14 MB
```

## Fuentes reales

```bash
npm run verify:fuentes
```

Resultado del 26/10/2026:

```text
✓ Valhalla FOSSGIS · ruteo bici (991 ms): 10.8 km, 41 min · CORS *
✓ BRouter · GeoJSON fastbike (867 ms): 9.66 km, 33 min · CORS *
✓ Mapas Bogotá · API de Ruteo (476 ms): 9.85 km, 35 min, 21 instrucciones · CORS *
✓ Nominatim · búsqueda (69 ms): 1 resultado · CORS *
✓ ArcGIS · capa oficial de ciclorrutas (292 ms): Cicloruta · esriGeometryPolygon · CORS http://localhost:4173
✓ IDECA · tesela del mapa base (272 ms): tesela 12/1995/1205 · image/png
✓ Overpass · consulta pequeña (43460 ms): 3 elementos (intento 3) · CORS *
✓ Mapas Bogotá · /buscar2 (no integrado) (15309 ms): HTTP 200 · {"status":false}

Resumen: 8/8 pruebas correctas; 0 fallos críticos.
```

Observaciones:

- Valhalla y BRouter pueden variar algunos metros o minutos entre consultas.
- Overpass respondió 504 en los dos primeros intentos y funcionó al tercero; el script reintenta y el resultado es variable.
- `/buscar2` devuelve HTTP 200 pero `status:false`; **no se usa** en la app.
- ArcGIS e IDECA devolvieron HTTP 500 cuando se enviaba a la vez un `User-Agent` propio y `Origin`; con un navegador real o solo con `Origin` responden 200. El script usa `Origin` sin el User-Agent propio para esas dos fuentes. Es un comportamiento del WAF/servicio, no de la app.

## Navegador: flujo en línea

Arnés CDP contra `vite preview` en `127.0.0.1:4173`, ventana 1440×900. Perfil de Chrome nuevo.

```text
INICIAL
  título: Viaja en Bici · Rutas ciclistas de Bogotá
  mapa: true
  estado: Elige un origen y un destino para empezar.
  offline: 0/8 archivos
  service worker: true

BÚSQUEDA
  texto: Plaza de Bolívar, Centro Administrativo, UPZs de Bogotá
  coordenadas: 4.59817, -74.07600
  cantidad: 1

EN LÍNEA
  estado: Rutas comparadas en 1.1 s con 5 fuentes en línea.
  rápida: 31 min · 10.1 km · Valhalla
  corta:  33 min ·  9.7 km · BRouter
  segura: 47 min · 11.0 km · Valhalla
  fuentes: Valhalla rápida/corta/segura, BRouter, Mapas Bogotá
  alternativas: 4
  rutas dibujadas en el mapa: 8
```

La ruta rápida mostró instrucciones reales («Vaya en bicicleta hacia el sureste por Calle 93A», «Gire a la derecha hacia Avenida Carrera 11», etc.). La tarjeta de Mapas Bogotá reportó 3 alternativas.

## Navegador: offline real

Secuencia exacta:

1. Clic en **Preparar datos**.
2. Chip: **Listo · 8/8**.
3. CDP `Network.emulateNetworkConditions` con `offline: true`.
4. `Page.reload`.
5. La app se abrió desde el service worker.
6. Clic en **Comparar rutas**.

```text
RECARGA_OFFLINE
  online: false
  título: Viaja en Bici · Rutas ciclistas de Bogotá
  botón de comparar: true
  estado: Ruta anterior restaurada. Pulsa «Comparar rutas» para actualizarla.
  mapa vectorial: true
  paquete: Listo · 8/8
  service worker: true

OFFLINE_REAL
  estado: Rutas calculadas sin conexión en 0.5 s.
  rápida: 34 min · 9.9 km · Motor local
  corta:  39 min · 9.7 km · Motor local
  segura: 41 min · 10.3 km · Motor local
  rutas dibujadas: 4
  canvas del mapa: 1
  fuentes: Motor local OSM, 3 perfiles sobre el grafo descargado
```

El detalle de la ruta local mostró 12 pasos agrupados y un estrés de 5,6/10 para la rápida. No hubo errores de consola al final del recorrido. Durante el corte sí se esperan errores de red de las teselas/API; el test los separa y no los cuenta como fallo de la app.

## Interfaz

```text
TEMA
  tema: oscuro
  fondo: rgb(8, 17, 28)

MÓVIL (390 CSS px)
  panel: fixed
  ancho: 390
  tarjetas: 3
  desbordamiento horizontal: false
  alto del mapa: 788
```

También se revisaron capturas de escritorio y móvil en [capturas](capturas/). No se detectó overflow horizontal.

### Mis rutas y origen GPS

Verificación de interfaz con **Firefox Developer Edition 159 headless**, `vite preview` en `127.0.0.1:4173` y datos sembrados en `localStorage`:

```text
ESCRITORIO (1440×900)
  origen por defecto: «Mi ubicación (GPS)» + etiqueta GPS
  resumen inicial: «Sin rutas guardadas»
  diálogo Mis rutas: 3 destinos y 1 favorita de prueba
  pestaña Favoritas: nombre, 10.1 km · 31 min · Rápida
  favorita guardada desde el detalle y visible en el panel
  favorita abierta: diálogo cerrado y comparación offline recalculada

MÓVIL (390×844)
  panel visible con «Mis rutas» antes de comparar
  diálogo dentro del ancho de la pantalla
  sin desbordamiento horizontal

RUTA SEGURA (offline)
  tarjeta seleccionada en magenta
  trazado magenta visible sobre el mapa
  «Mis rutas» actualizado a 1 destino tras la comparación
```

No se probó el permiso de GPS real en Firefox ni en Android. Los flujos de GPS se validan por código y por las pruebas de sesión; la prueba física sigue pendiente.

## Android

Compilación:

```bash
cd android
ANDROID_HOME=/home/cudox/Android/Sdk \
JAVA_HOME=/usr/lib/jvm/java-21-openjdk \
./gradlew assembleDebug --no-daemon
```

Resultado:

```text
BUILD SUCCESSFUL
129 actionable tasks
APK: app/build/outputs/apk/debug/app-debug.apk
Tamaño: 12 MB
```

> Este APK se compiló antes de la rama de **Mis rutas** y del cambio de color de la ruta segura. Los datos de Android siguen siendo válidos, pero el binario debe regenerarse después de validar la web.

Verificación con `aapt`:

```text
package: co.viajaenbici.app
versionCode: 1
versionName: 0.1.0
sdkVersion: 24
targetSdkVersion: 36
application-label: Viaja en Bici
```

Permisos: INTERNET, ACCESS_NETWORK_STATE, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION.

Assets comprobados:

```text
assets/public/index.html
assets/public/assets/index-*.js
assets/public/sw.js
assets/public/data/grafo-bogota.json.gz.bin  → 19.216.646 bytes al descomprimir
assets/public/data/base-bogota.geojson
assets/public/data/ciclorrutas.geojson
```

El primer build falló por un recurso duplicado (`ic_launcher_background` definido en dos XML). Se corrigió y el segundo build terminó correctamente. También se detectó que AAPT quitaba la extensión `.gz` al empaquetar; se renombró el archivo a `.json.gz.bin` y se verificó el nombre dentro del APK.

## Pruebas no realizadas

- Instalación y ejecución en un teléfono Android físico.
- Emulador Android (no había imagen ni KVM configurado).
- GPS real, brújula y permisos concedidos/denegados en Android.
- iOS.
- Lector de pantalla y navegación completa por teclado.
- Firma release y publicación en Play Store.
- Pruebas de carga con muchos usuarios.
- Safari; Firefox se usó para capturas de interfaz, no para service worker ni `DecompressionStream`.
- Disponibilidad a largo plazo de los servicios públicos.
- Actualización automática de datos.

## Cómo repetir

```bash
cd /data/Proyectos/viajaEnBici
npm install
npm test
npm run build
npm run verify:fuentes
npm run preview
```

Abre `http://127.0.0.1:4173`, pulsa «Preparar datos», activa el modo offline en DevTools y recarga. Para Android, sigue [ANDROID.md](ANDROID.md).

El arnés CDP usado para las capturas y las pruebas de red fue temporal (`/tmp/opencode/veb-test.mjs`) y no forma parte del repositorio. Las pruebas automatizadas versionadas son las de `tests/` y `scripts/verify-sources.mjs`.
