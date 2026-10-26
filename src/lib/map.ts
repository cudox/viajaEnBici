import L from 'leaflet';
import { BOGOTA, CAPAS, COLORES, DATOS } from '../config';
import type { LatLng, Lugar, RutaBici } from '../types';

export const ESTILOS_SUPERFICIE: Record<
  number,
  { nombre: string; color: string; relleno: string }
> = {
  0: { nombre: 'Sin dato', color: '#64748b', relleno: '#94a3b8' },
  1: { nombre: 'Concreto', color: '#0891b2', relleno: '#22d3ee' },
  2: { nombre: 'Asfalto', color: '#15803d', relleno: '#4ade80' },
  3: { nombre: 'Mixtos', color: '#7c3aed', relleno: '#a78bfa' },
  4: { nombre: 'Adoquín concreto', color: '#b45309', relleno: '#fbbf24' },
  5: { nombre: 'Adoquín arcilla', color: '#9a3412', relleno: '#fb923c' },
};

const ESTILO_BASE: Record<string, { color: string; weight: number }> = {
  motorway: { color: '#334155', weight: 4 },
  trunk: { color: '#475569', weight: 3.5 },
  primary: { color: '#64748b', weight: 3 },
  secondary: { color: '#94a3b8', weight: 2.2 },
  tertiary: { color: '#cbd5e1', weight: 1.6 },
  cycleway: { color: '#22c55e', weight: 2.4 },
  path: { color: '#86efac', weight: 1.4 },
};

const ICONO_ORIGEN = L.divIcon({
  className: 'marcador-mapa',
  html: '<span class="pin pin-origen" aria-label="Origen">A</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});
const ICONO_DESTINO = L.divIcon({
  className: 'marcador-mapa',
  html: '<span class="pin pin-destino" aria-label="Destino">B</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export interface OpcionesMapa {
  contenedor: HTMLElement;
  tema: 'claro' | 'oscuro';
  alHacerClic?: (lat: number, lon: number) => void;
  alMoverMarcador?: (tipo: 'origen' | 'destino', lat: number, lon: number) => void;
  alCambiarCapa?: (mensaje: string) => void;
}

export class MapaViaje {
  readonly mapa: L.Map;
  private capaTeselas: L.TileLayer;
  private capaVectorial: L.GeoJSON | null = null;
  private capaCiclorrutas: L.GeoJSON | null = null;
  private grupoRutas: L.LayerGroup;
  private marcadorOrigen: L.Marker | null = null;
  private marcadorDestino: L.Marker | null = null;
  private opciones: OpcionesMapa;
  private tema: 'claro' | 'oscuro';
  private vectorVisible = false;
  private ciclorrutasVisible = false;
  private renderer: L.Canvas;

  constructor(opciones: OpcionesMapa) {
    this.opciones = opciones;
    this.tema = opciones.tema;
    this.mapa = L.map(opciones.contenedor, {
      center: BOGOTA.centro,
      zoom: BOGOTA.zoom,
      zoomControl: false,
      attributionControl: true,
      maxBounds: [
        [4.2, -74.5],
        [5.0, -73.7],
      ],
      minZoom: 10,
      maxZoom: 19,
    });
    this.renderer = L.canvas({ padding: 0.4 });

    this.mapa.createPane('baseVectorial');
    this.mapa.getPane('baseVectorial')!.style.zIndex = '210';
    this.mapa.createPane('ciclorrutas');
    this.mapa.getPane('ciclorrutas')!.style.zIndex = '330';
    this.mapa.createPane('rutas');
    this.mapa.getPane('rutas')!.style.zIndex = '430';
    this.mapa.createPane('marcadores');
    this.mapa.getPane('marcadores')!.style.zIndex = '620';

    this.capaTeselas = this.crearCapaTeselas(this.tema).addTo(this.mapa);
    L.control.zoom({ position: 'bottomright' }).addTo(this.mapa);
    L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(this.mapa);

    this.grupoRutas = L.layerGroup().addTo(this.mapa);
    this.mapa.on('click', (evento: L.LeafletMouseEvent) => {
      this.opciones.alHacerClic?.(evento.latlng.lat, evento.latlng.lng);
    });
  }

  private crearCapaTeselas(tema: 'claro' | 'oscuro'): L.TileLayer {
    return L.tileLayer(tema === 'oscuro' ? CAPAS.oscuro : CAPAS.claro, {
      attribution: CAPAS.atribucion,
      maxZoom: 19,
      detectRetina: true,
    });
  }

  setTema(tema: 'claro' | 'oscuro'): void {
    this.tema = tema;
    this.mapa.removeLayer(this.capaTeselas);
    this.capaTeselas = this.crearCapaTeselas(tema);
    if (!this.vectorVisible) this.capaTeselas.addTo(this.mapa);
    this.reestilizar();
  }

  private reestilizar(): void {
    const oscuro = this.tema === 'oscuro';
    this.capaVectorial?.setStyle((feature) => {
      const clase = (feature?.properties as { c?: string } | undefined)?.c ?? 'tertiary';
      const estilo = ESTILO_BASE[clase] ?? ESTILO_BASE.tertiary;
      return {
        color: oscuro ? '#64748b' : estilo.color,
        weight: estilo.weight,
        opacity: oscuro ? 0.85 : 0.9,
      };
    });
    this.capaCiclorrutas?.setStyle((feature) =>
      this.estiloCiclorruta(
        (feature?.properties as { superficie?: number } | undefined)?.superficie,
      ),
    );
  }

  private estiloCiclorruta(superficie?: number): L.PathOptions {
    const estilo = ESTILOS_SUPERFICIE[superficie ?? 0] ?? ESTILOS_SUPERFICIE[0];
    return {
      color: estilo.color,
      weight: 2.5,
      opacity: 0.85,
      fillColor: estilo.relleno,
      fillOpacity: 0.22,
      lineJoin: 'round',
    };
  }

  async cargarCiclorrutas(): Promise<number> {
    this.opciones.alCambiarCapa?.('Cargando ciclorrutas oficiales…');
    const respuesta = await fetch(new URL(DATOS.ciclorrutas, document.baseURI));
    if (!respuesta.ok) throw new Error(`No se pudo cargar la capa de ciclorrutas (HTTP ${respuesta.status}).`);
    const datos = (await respuesta.json()) as GeoJSON.FeatureCollection;
    const opciones = {
      renderer: this.renderer,
      pane: 'ciclorrutas',
      style: (feature: GeoJSON.Feature | undefined) =>
        this.estiloCiclorruta(
          (feature?.properties as { superficie?: number } | undefined)?.superficie,
        ),
      onEachFeature: (feature: GeoJSON.Feature, capa: L.Layer) => {
        const props = feature.properties as
          | { superficieNombre?: string; codigo?: string; civ?: string }
          | null;
        const nombre = props?.superficieNombre ?? 'Sin dato';
        capa.bindTooltip(
          `<strong>Ciclorruta oficial</strong><br>Superficie: ${nombre}${props?.codigo ? `<br>Código: ${props.codigo}` : ''}`,
          { sticky: true },
        );
      },
    } as L.GeoJSONOptions & { renderer: L.Canvas };
    this.capaCiclorrutas = L.geoJSON(datos, opciones);
    if (this.ciclorrutasVisible) this.capaCiclorrutas.addTo(this.mapa);
    this.opciones.alCambiarCapa?.(`${datos.features.length.toLocaleString('es-CO')} ciclorrutas oficiales cargadas.`);
    return datos.features.length;
  }

  async setCiclorrutas(visible: boolean): Promise<void> {
    this.ciclorrutasVisible = visible;
    if (visible) {
      if (!this.capaCiclorrutas) await this.cargarCiclorrutas();
      else this.capaCiclorrutas.addTo(this.mapa);
    } else if (this.capaCiclorrutas) {
      this.mapa.removeLayer(this.capaCiclorrutas);
    }
  }

  async cargarMapaVectorial(): Promise<void> {
    if (this.capaVectorial) return;
    this.opciones.alCambiarCapa?.('Cargando mapa base sin conexión…');
    const respuesta = await fetch(new URL(DATOS.base, document.baseURI));
    if (!respuesta.ok) throw new Error(`No se pudo cargar el mapa vectorial (HTTP ${respuesta.status}).`);
    const datos = (await respuesta.json()) as GeoJSON.FeatureCollection;
    const opciones = {
      renderer: this.renderer,
      pane: 'baseVectorial',
      style: (feature: GeoJSON.Feature | undefined) => {
        const clase = (feature?.properties as { c?: string } | undefined)?.c ?? 'tertiary';
        const estilo = ESTILO_BASE[clase] ?? ESTILO_BASE.tertiary;
        return { color: estilo.color, weight: estilo.weight, opacity: 0.9 };
      },
      onEachFeature: (feature: GeoJSON.Feature, capa: L.Layer) => {
        const nombre = (feature.properties as { n?: string } | null)?.n;
        if (nombre) capa.bindTooltip(nombre, { sticky: true });
      },
    } as L.GeoJSONOptions & { renderer: L.Canvas };
    this.capaVectorial = L.geoJSON(datos, opciones);
    if (this.vectorVisible) this.capaVectorial.addTo(this.mapa);
    this.opciones.alCambiarCapa?.('Mapa base vectorial listo para usar sin conexión.');
  }

  async setMapaVectorial(visible: boolean): Promise<void> {
    this.vectorVisible = visible;
    if (visible) {
      await this.cargarMapaVectorial();
      if (this.mapa.hasLayer(this.capaTeselas)) this.mapa.removeLayer(this.capaTeselas);
      this.capaVectorial?.addTo(this.mapa);
    } else {
      this.capaVectorial?.removeFrom(this.mapa);
      if (!this.mapa.hasLayer(this.capaTeselas)) this.capaTeselas.addTo(this.mapa);
    }
  }

  setOrigen(lugar: Lugar | undefined): void {
    if (!lugar) {
      if (this.marcadorOrigen) this.mapa.removeLayer(this.marcadorOrigen);
      this.marcadorOrigen = null;
      return;
    }
    if (this.marcadorOrigen) {
      this.marcadorOrigen.setLatLng([lugar.lat, lugar.lon]);
    } else {
      this.marcadorOrigen = L.marker([lugar.lat, lugar.lon], {
        icon: ICONO_ORIGEN,
        draggable: true,
        pane: 'marcadores',
        title: `Origen: ${lugar.etiqueta}`,
      }).addTo(this.mapa);
      this.marcadorOrigen.on('dragend', () => {
        const pos = this.marcadorOrigen?.getLatLng();
        if (pos) this.opciones.alMoverMarcador?.('origen', pos.lat, pos.lng);
      });
    }
    this.marcadorOrigen.setTooltipContent(`Origen: ${lugar.etiqueta}`);
  }

  setDestino(lugar: Lugar | undefined): void {
    if (!lugar) {
      if (this.marcadorDestino) this.mapa.removeLayer(this.marcadorDestino);
      this.marcadorDestino = null;
      return;
    }
    if (this.marcadorDestino) {
      this.marcadorDestino.setLatLng([lugar.lat, lugar.lon]);
    } else {
      this.marcadorDestino = L.marker([lugar.lat, lugar.lon], {
        icon: ICONO_DESTINO,
        draggable: true,
        pane: 'marcadores',
        title: `Destino: ${lugar.etiqueta}`,
      }).addTo(this.mapa);
      this.marcadorDestino.on('dragend', () => {
        const pos = this.marcadorDestino?.getLatLng();
        if (pos) this.opciones.alMoverMarcador?.('destino', pos.lat, pos.lng);
      });
    }
    this.marcadorDestino.setTooltipContent(`Destino: ${lugar.etiqueta}`);
  }

  dibujarRutas(rutas: RutaBici[], activa: string | null): void {
    this.grupoRutas.clearLayers();
    const orden = [...rutas].sort((a, b) => (a.id === activa ? 1 : 0) - (b.id === activa ? 1 : 0));
    for (const ruta of orden) {
      const color =
        ruta.perfil === 'rapida'
          ? COLORES.rapida
          : ruta.perfil === 'corta'
            ? COLORES.corta
            : ruta.perfil === 'segura'
              ? COLORES.segura
              : COLORES.offline;
      const seleccionada = ruta.id === activa;
      if (seleccionada) {
        L.polyline(ruta.geometria, {
          pane: 'rutas',
          color: '#ffffff',
          weight: 9,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(this.grupoRutas);
      }
      L.polyline(ruta.geometria, {
        pane: 'rutas',
        color,
        weight: seleccionada ? 5.5 : 3,
        opacity: seleccionada ? 0.98 : 0.55,
        dashArray: seleccionada ? undefined : '6 8',
        lineCap: 'round',
        lineJoin: 'round',
      })
        .bindTooltip(
          `${ruta.perfil ? ruta.perfil.toUpperCase() : 'Alternativa'} · ${(ruta.distanciaM / 1000).toFixed(1)} km · ${Math.round(ruta.duracionS / 60)} min · ${ruta.proveedorEtiqueta}`,
          { sticky: true },
        )
        .addTo(this.grupoRutas);
    }
  }

  limpiarRutas(): void {
    this.grupoRutas.clearLayers();
  }

  ajustarRuta(geometria: LatLng[]): void {
    if (geometria.length < 2) return;
    const bounds = L.latLngBounds(geometria.map(([lat, lon]) => [lat, lon]));
    this.mapa.flyToBounds(bounds, { padding: [70, 70], duration: 0.7, maxZoom: 16 });
  }

  verBogota(): void {
    this.mapa.flyTo(BOGOTA.centro, BOGOTA.zoom, { duration: 0.6 });
  }

  invalidarTamano(): void {
    this.mapa.invalidateSize();
  }

  get capaCiclorrutasCargada(): boolean {
    return Boolean(this.capaCiclorrutas);
  }

  get mapaVectorialCargado(): boolean {
    return Boolean(this.capaVectorial);
  }
}
