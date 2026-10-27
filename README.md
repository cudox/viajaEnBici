# Viaja en Bici

Aplicación de rutas ciclistas para Bogotá. Compara tres perfiles —**rápida**, **corta** y **segura**—, dibuja las ciclorrutas oficiales y puede calcular rutas **sin conexión** en el propio dispositivo, sin depender de que el mapa o una respuesta anterior sigan en caché.

> Estado: MVP funcional de web + Android (APK debug). Código publicado en [github.com/cudox/viajaEnBici](https://github.com/cudox/viajaEnBici).

![Rutas en línea sobre el mapa de Bogotá](docs/capturas/rutas-online.png)

## Qué incluye

- **Mapa de Bogotá** con el Mapa Base oficial de IDECA/Catastro Distrital (claro y oscuro) y la capa oficial de **6.311 ciclorrutas** del IDU.
- **Búsqueda de direcciones** con Nominatim, limitada a Bogotá y con caché y control de frecuencia.
- **Comparación real de rutas**:
  - más rápida por duración;
  - más corta por distancia;
  - segura, con el perfil de Valhalla que prioriza ciclorrutas y evita vías de mayor tráfico;
  - alternativas de BRouter y de la API de Ruteo de Mapas Bogotá.
- **Instrucciones giro a giro** cuando el motor las entrega (Valhalla y Mapas Bogotá).
- **Origen/destino** por texto, clic en el mapa, marcador arrastrable o geolocalización.
- **Origen GPS por defecto**: si no fijas un origen, la app toma tu ubicación actual al comparar. El GPS se consulta solo por acción del usuario y, si falla, se puede elegir un origen manual.
- **Mis rutas**:
  - destinos recientes guardados automáticamente (sin guardar el origen);
  - favoritas con origen y destino fijos;
  - al abrir un destino reciente se recalcula desde la ubicación actual;
  - al abrir una favorita se vuelve a comparar con los motores actuales;
  - historial local, sin cuentas ni servidor, con opción de borrarlo.
- **Modo sin conexión real**:
  - grafo ciclable propio de OpenStreetMap (320.191 nodos y 358.236 aristas);
  - mapa base vectorial local;
  - ciclorrutas oficiales empaquetadas;
  - Dijkstra en un Web Worker con métricas de distancia, tiempo y seguridad;
  - service worker para el armazón de la PWA y los datos.
- **Android** con Capacitor, paquete `co.viajaenbici.app`, nombre «Viaja en Bici», iconos y splash propios.
- Interfaz responsive en español, temas claro/oscuro, estado de conexión y persistencia local de preferencias, sesión y Mis rutas.

| Rutas en línea | Sin conexión, mapa vectorial |
| --- | --- |
| ![Rutas en línea](docs/capturas/rutas-online.png) | ![Rutas sin conexión](docs/capturas/rutas-offline.png) |

| Búsqueda de direcciones | Móvil |
| --- | --- |
| ![Búsqueda](docs/capturas/busqueda.png) | ![Vista móvil](docs/capturas/movil.png) |

## Inicio rápido

Requisitos: Node.js ≥ 22.12 y npm. El proyecto fue probado con Node 26.11.1 y npm 12.2.1.

```bash
cd /data/Proyectos/viajaEnBici
npm install
npm run dev          # http://127.0.0.1:5173
```

La app funciona sin variables de entorno ni claves API. Los datos de Bogotá ya están incluidos en `public/data/`.

```bash
npm test             # pruebas de geometría, normalización, motor offline y almacenamiento
npm run build        # comprueba tipos y genera dist/
npm run preview      # sirve dist/ en http://127.0.0.1:4173
npm run verify:fuentes
```

`verify:fuentes` consulta los servicios reales (Valhalla, BRouter, Mapas Bogotá, Nominatim, ArcGIS, IDECA y Overpass) y devuelve código 1 si falla una fuente crítica. Los servicios públicos pueden tardar o limitar peticiones.

## Origen GPS y Mis rutas

El origen es **la ubicación actual por defecto**. No se pide GPS al abrir la app: se resuelve cuando pulsas «Comparar rutas», eliges un destino reciente o usas el botón de ubicación. Si el permiso se deniega, la app lo informa y permite fijar el origen manualmente.

El historial guarda **solo destinos**, no el origen de cada consulta. Al tocar un destino reciente se calcula desde donde estés en ese momento. Las **favoritas** son distintas: conservan un origen y un destino fijos y se recalculan al abrirlas.

```text
Mis rutas
├── Destinos recientes   ──► destino guardado + GPS actual
└── Favoritas            ──► origen y destino guardados
```

Los datos quedan en `localStorage` del navegador o del WebView. No hay cuentas, sincronización ni envío del historial a un servidor. El guardado automático se puede desactivar y el historial se puede borrar desde el panel.

## Android

El proyecto nativo está en `android/` y el APK debug ya compilado en:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

> El APK debug fue recompilado con **Mis rutas** y el nuevo color de la ruta segura. Sigue pendiente instalarlo en un teléfono físico.

Para regenerarlo:

```bash
npm run android:apk
```

Requiere Android SDK con plataforma 36 y JDK 21. En CachyOS, los pasos exactos (instalación del SDK, permisos, firma y solución de problemas) están en [docs/ANDROID.md](docs/ANDROID.md).

Datos verificados del APK:

```text
package: co.viajaenbici.app
versionName: 0.1.0
minSdk: 24
targetSdk: 36
application-label: Viaja en Bici
tamaño: 12 MB
```

No se ha probado en un teléfono físico ni en un emulador porque no había dispositivo conectado. El APK compila y su manifiesto, recursos y datos empaquetados fueron verificados.

## Cómo funciona la comparación

```text
Origen/destino
      │
      ├── Valhalla (rápida, corta, segura) ─┐
      ├── BRouter (fastbike) ──────────────┤
      └── Mapas Bogotá (hasta 3 rutas) ────┘
                                             │
                         normalización + selección
                                             │
        rápida = menor duración · corta = menor distancia
        segura = perfil seguro de Valhalla (o respaldo local)
```

Si los servicios en línea fallan, la app intenta el motor local como respaldo. Si el usuario elige «Siempre sin conexión» o no hay red, calcula directamente con el grafo local.

La selección no falsea etiquetas: las tarjetas muestran la fuente real de cada ruta y los tiempos son estimaciones de cada motor. La ruta «corta» puede venir de BRouter y la «rápida» de Valhalla.

## Datos offline

| Archivo | Uso | Tamaño |
| --- | --- | --- |
| `public/data/grafo-bogota.json.gz.bin` | grafo ciclable comprimido | 4,62 MB |
| `public/data/base-bogota.geojson` | mapa base vectorial | 3,56 MB |
| `public/data/ciclorrutas.geojson` | capa oficial de ciclorrutas | 3,8 MB |

El grafo se construye desde OpenStreetMap con `scripts/fetch-osm.mjs` y `scripts/build-offline-graph.mjs`. Se deduplican aristas, se conservan sentidos viales y se asignan velocidad y estrés por tipo de vía. La app lo descarga comprimido, lo descomprime con `DecompressionStream` y lo procesa en un Web Worker.

El modo offline no es «guardar tiles»: incluye un mapa vectorial propio y un motor de rutas local. Los detalles, límites y verificación real están en [docs/OFFLINE.md](docs/OFFLINE.md).

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md): módulos, flujo de datos, decisiones técnicas.
- [Fuentes y APIs](docs/FUENTES.md): endpoints probados, CORS, licencias y limitaciones.
- [Modo sin conexión](docs/OFFLINE.md): estrategia, empaquetado y pruebas.
- [Android](docs/ANDROID.md): CachyOS, SDK, compilación y APK.
- [Pruebas](docs/PRUEBAS.md): comandos, resultados reales y pendientes.

## Estructura

```text
src/
  config.ts              configuración de app, capas y endpoints
  types.ts               tipos compartidos
  lib/
    geo.ts               distancias, rumbos, polilíneas
    geocoding.ts         Nominatim y geolocalización
    map.ts               Leaflet, capas y marcadores
    offline-pack.ts      caché del paquete offline
    rutas-guardadas.ts   destinos recientes y favoritas en almacenamiento local
    routing/
      valhalla.ts        normalización de Valhalla
      brouter.ts         normalización de BRouter
      mapas-bogota.ts    API de Ruteo de Mapas Bogotá
      offline-graph.ts   grafo, índice, Dijkstra y pasos
      offline.worker.ts  Web Worker
      offline-client.ts  cliente del worker
      compare.ts         comparación y respaldo
  ui/app.ts              controlador de la interfaz
public/
  data/                  datos de Bogotá
  sw.js                  service worker
scripts/                 descarga y construcción de datos
tests/                   Vitest
android/                 proyecto Capacitor Android
docs/                    documentación y capturas
```

## Estado y pendientes

Completado y verificado:

- Web funcional con rutas reales de Valhalla, BRouter y Mapas Bogotá.
- Capa oficial de ciclorrutas y mapa base IDECA.
- Motor offline real con rutas de ~9,7–10,3 km en 0,5 s tras la carga.
- Service worker y recarga completa sin red.
- Mis rutas con destinos recientes, favoritas y origen GPS por defecto; almacenamiento local sin backend.
- Pruebas automatizadas y APK debug compilado.
- Repositorio público publicado en `https://github.com/cudox/viajaEnBici` (commit inicial `d673d77`).

Pendiente o condicionado:

1. **Probar el APK en un dispositivo**: el binario ya se recompiló con Mis rutas y el color magenta. No hay `adb` con dispositivo conectado ni emulador, así que la instalación y la prueba física siguen pendientes.
2. **Servicios públicos**: Valhalla FOSSGIS, BRouter, Nominatim y las APIs de Bogotá son demostraciones. Para producción deben autohospedarse o revisarse sus políticas y límites.
3. **Datos estáticos**: el grafo es una foto de OpenStreetMap. No hay actualización automática ni tráfico en vivo.
4. **`/buscar2` de Mapas Bogotá**: el endpoint respondió `{"status":false}` con los parámetros probados. No se integra; la búsqueda usa Nominatim.
5. **Firma de producción**: el APK generado es debug. Publicar en Play Store requiere keystore y un build release firmado.

## Licencias

El código de este repositorio se distribuye bajo licencia MIT (ver `LICENSE`). Los datos y servicios tienen sus propias licencias:

- OpenStreetMap: © colaboradores de OpenStreetMap, ODbL 1.0.
- Ciclorrutas: IDU / Catastro Distrital, datos abiertos de Bogotá; consultar términos de uso.
- Mapa Base: IDECA / UAECD, Catastro Bogotá.
- Valhalla, BRouter, Nominatim y FOSSGIS: servicios públicos con sus respectivas políticas de uso.
- Leaflet: BSD-2-Clause.

Ver [docs/FUENTES.md](docs/FUENTES.md) para atribuciones y condiciones.
