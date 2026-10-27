# Arquitectura

## Objetivo y restricciones

Viaja en Bici es una aplicación pequeña, sin backend propio, que debe funcionar en navegador y en Android aunque se corte la red. Las prioridades son:

1. mapa útil de Bogotá y búsqueda de direcciones;
2. comparación de una ruta rápida, una corta y una segura;
3. ciclorrutas oficiales;
4. enrutamiento local real, no solo teselas cacheadas;
5. interfaz responsive, en español y sin claves API.

Por eso se eligió TypeScript + Vite + Leaflet, con Capacitor para reutilizar la misma aplicación en Android. No se añadió un framework de UI ni un servidor: el producto es un cliente estático y el coste de mantenimiento se concentra en los datos y el motor de rutas.

## Componentes

```text
index.html + src/ui/app.ts
        │
        ├── src/lib/map.ts            Leaflet: teselas IDECA, ciclorrutas, rutas, marcadores
        ├── src/lib/geocoding.ts      Nominatim + geolocalización del navegador
        ├── src/lib/offline-pack.ts   Cache Storage del paquete offline
        ├── src/lib/rutas-guardadas.ts destinos recientes y favoritas (localStorage)
        └── src/lib/routing/
              ├── compare.ts          orquesta motores y elige perfiles
              ├── valhalla.ts         POST /route, tres juegos de costing
              ├── brouter.ts          GET /brouter, perfil fastbike
              ├── mapas-bogota.ts     API de Ruteo (GraphHopper), hasta 3 alternativas
              ├── offline-client.ts   puente con el Web Worker
              ├── offline.worker.ts   carga y ejecuta el grafo
              └── offline-graph.ts    índice, snapping, Dijkstra e instrucciones
```

### `src/config.ts`

Centraliza el nombre, la versión, el ID Android, los límites de Bogotá, las URLs de teselas y APIs, las rutas de datos y el nombre de la caché. Cambiar una fuente no requiere tocar la UI.

### `src/lib/map.ts`

Crea el mapa Leaflet, las capas de teselas oficiales (clara y oscura), la capa GeoJSON de ciclorrutas, la capa vectorial offline, los marcadores A/B y las rutas. Las teselas externas se piden directamente; no se cachean de forma masiva porque el modo offline usa el mapa vectorial local.

### `src/lib/routing/compare.ts`

Lanza en paralelo:

- Valhalla con perfiles `rapida`, `corta` y `segura`;
- BRouter con `fastbike`;
- Mapas Bogotá con hasta tres alternativas.

Cada tarea falla de forma independiente (`Promise.allSettled`). Si al menos una devuelve una ruta, la comparación continúa y se muestran las fuentes caídas. Si todas fallan, se intenta el motor local como respaldo. El resultado se cachea en memoria durante 5 minutos por coordenadas redondeadas y modo.

La selección es explícita:

- **rápida**: menor `duracionS`; desempata por distancia;
- **corta**: menor `distanciaM`; desempata por duración; si es la misma geometría/totales que la rápida, se busca otra;
- **segura**: la ruta de Valhalla calculada con el perfil seguro; si no existe, la ruta offline; si tampoco, la rápida.

Las rutas sobrantes, hasta cuatro, se muestran como alternativas. No se renombra una ruta de BRouter como «segura»: la tarjeta indica el proveedor real.

### Perfiles de Valhalla

| Perfil | Bicicleta | Uso de vías | Colinas | Superficies malas | Velocidad |
| --- | --- | --- | --- | --- | --- |
| Rápida | road | 0,9 | 0,4 | 0,2 | 22 km/h |
| Corta | hybrid | 0,5 | 0,5 | 0,5 | 18 km/h |
| Segura | hybrid | 0,1 | 0,2 | 1,0 | 16 km/h |

La etiqueta «segura» es una **aproximación**: Valhalla no conoce el estado actual de una ciclorruta ni el tráfico en tiempo real. Evita vías principales y superficies malas, pero no garantiza seguridad objetiva.

### BRouter

Se usa el perfil público `fastbike` con `format=geojson`. BRouter devuelve geometría y totales (`track-length`, `total-time`, ascenso), pero no instrucciones giro a giro en este formato. La app lo indica en la ruta y en el detalle.

### Mapas Bogotá

La API de Ruteo expone GraphHopper con `vehicle=bike`, `locale=es`, `points_encoded=false`, `elevation=true` y `algorithm=alternative_route`. Se piden tres alternativas y se normalizan a `RutaBici`. Es la única fuente en línea que entrega instrucciones en español además de Valhalla.

### Motor offline

El grafo es un JSON compacto:

```text
nodos:   [[lat, lon], ...]
aristas: [[a, b, longitudM, clase, nombre, bits, velocidadKmh, estrés], ...]
nombres: [...]
clases:  [{ id, v, s }, ...]
```

`bits` indica si la arista se recorre en un sentido, en el otro o en ambos. Al procesar el grafo se construye una lista de adyacencia (`offsets`, `destinos`, `aristas`) y un índice espacial por celdas de 0,0025°.

El cálculo corre en `offline.worker.ts` para no bloquear la interfaz:

1. `nodoMasCercano` busca en la celda y en las celdas vecinas; rechaza puntos a más de **400 m** de la red.
2. Dijkstra con montículo binario. El coste depende del perfil:
   - rápida: `longitud / velocidad`;
   - corta: `longitud`;
   - segura: `longitud × estrés`.
3. Se reconstruye la ruta, se agrupan aristas por nombre y clase y se generan instrucciones con rumbo y giro.
4. La duración se estima con la velocidad de cada tipo de vía; no se consulta tráfico.

El detalle completo, incluido el formato y la verificación, está en [OFFLINE.md](OFFLINE.md).

## Origen GPS y Mis rutas

El estado del origen es explícito: `actual` o `manual`.

- `actual` es el valor por defecto. El campo muestra «Mi ubicación (GPS)» y el GPS se resuelve al comparar, al elegir un destino reciente o al pulsar el botón de ubicación. No se pide permiso al abrir la app ni se guardan las coordenadas del origen en la sesión.
- `manual` se activa al buscar una dirección, elegir un punto en el mapa o arrastrar el marcador A. Ese origen se conserva entre recargas.
- Si el GPS falla o el permiso se deniega, la app informa y deja fijar el origen a mano.

`src/lib/rutas-guardadas.ts` mantiene dos listas independientes en `localStorage`:

| Lista | Contenido | Límite | Comportamiento |
| --- | --- | ---: | --- |
| Destinos recientes | destino, fecha, veces usado | 30 | deduplica por coordenadas; no guarda el origen |
| Favoritas | nombre, origen, destino, perfil y métricas | 100 | se actualiza si repites el mismo par A/B |

Los destinos recientes se registran solo después de una comparación exitosa. Al abrir uno se limpia el origen, se resuelve el GPS actual y se comparan las rutas. Las favoritas fijan A y B y se recalculan al abrirlas. `guardarRecientes` se puede desactivar en el panel; las favoritas no dependen de esa preferencia.

No hay backend ni sincronización. El historial se puede borrar desde el panel y también se elimina con `borrarDatosLocales()` junto con las preferencias y la sesión.

## Flujo de una consulta

```text
Usuario elige A y B
        │
        ├─ A = ubicación actual (por defecto)
        │       └─ GPS bajo demanda ──► coordenadas A
        │
        ├─ modo auto/siempre offline ──► Worker: grafo local ──► 3 rutas
        │
        └─ modo en línea
                ├─ Valhalla rápida/corta/segura
                ├─ BRouter fastbike
                └─ Mapas Bogotá alternativas
                        │
                  normalización
                        │
             tarjetas + detalle + fuentes
                        │
              Leaflet dibuja hasta 8 trazados
                        │
          guarda destino en Mis rutas (si está activo)
```

Si el usuario pulsa «Probar motor local», se precarga el grafo y, si ya hay destino, se calcula inmediatamente la comparación offline (con GPS si el origen está en modo actual).

## Persistencia

- `localStorage`:
  - `veb.prefs.v1`: tema, modo offline, capas y `guardarRecientes`;
  - `veb.sesion.v1`: último origen manual, destino y modo de origen;
  - `veb.destinos.v1`: hasta 30 destinos recientes;
  - `veb.favoritas.v1`: hasta 100 rutas favoritas.
- `Cache Storage` (`viajaenbici-v3`): ocho archivos de datos, documento, JS/CSS con hash e iconos.
- Memoria: caché de rutas de 5 minutos.

No hay cuentas, analítica ni cookies de terceros. Los destinos recientes no guardan el origen. Las coordenadas se envían a los servicios públicos solo cuando el usuario compara en línea o busca una dirección.

## Service worker

`public/sw.js`:

- precarga el armazón (`index.html`, JS/CSS con hash, manifest e iconos);
- para navegaciones usa red primero y cae a la copia local;
- para `/data/` usa «stale-while-revalidate»;
- para el resto del mismo origen usa cache-first;
- no intercepta APIs ni teselas externas.

El armazón se cachea también al pulsar «Preparar datos», porque el service worker puede no controlar la primera visita. Esto permite recargar la app sin red incluso en una instalación nueva.

## Decisiones y compromisos

- **Sin backend**: más simple y barato, pero dependiente de servicios públicos y de datos estáticos.
- **Sin React**: la interfaz es un formulario, tarjetas y un mapa; el DOM directo evita peso y complejidad.
- **Datos empaquetados**: el primer uso no necesita descargar 12 MB de datos. A cambio, el APK ocupa 12 MB y el grafo se actualiza solo cuando se regenera.
- **Mapa vectorial offline esquemático**: se eligieron vías estructurantes y ciclorrutas para que quepa y se dibuje rápido; no es un mapa topográfico completo.
- **Seguridad heurística**: el estrés por tipo de vía y las opciones de Valhalla son una ayuda, no una auditoría de seguridad vial.

## Límites conocidos

- Sin tráfico, obras, cierres ni estado actual de ciclorrutas.
- Sin elevación en las respuestas de Valhalla usadas (la API puede no devolver `elevation_gained`).
- BRouter no da giros.
- El snapping offline puede fallar si el punto está a más de 400 m de la red.
- Los servicios públicos pueden limitar peticiones; ver [FUENTES.md](FUENTES.md).
- No se ha probado en un dispositivo Android físico.
