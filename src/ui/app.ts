import { APP } from '../config';
import type {
  ConjuntoRutas,
  Lugar,
  PerfilRuta,
  RutaBici,
} from '../types';
import { buscarLugares, describirPunto, obtenerUbicacion } from '../lib/geocoding';
import { escaparHtml, formatearDistancia, formatearDuracion } from '../lib/format';
import { mensajeError } from '../lib/http';
import { MapaViaje } from '../lib/map';
import {
  prepararPaqueteOffline,
  tamanoLegible,
  verificarPaqueteOffline,
} from '../lib/offline-pack';
import { compararRutas } from '../lib/routing/compare';
import { precargarOffline } from '../lib/routing/offline-client';
import {
  cargarPreferencias,
  cargarSesion,
  guardarPreferencias,
  guardarSesion,
  guardarUltimaRuta,
} from '../lib/storage';

const PERFILES: Array<{ id: PerfilRuta; nombre: string }> = [
  { id: 'rapida', nombre: 'Rápida' },
  { id: 'corta', nombre: 'Corta' },
  { id: 'segura', nombre: 'Segura' },
];

const PROVEEDOR_CORTO: Record<RutaBici['proveedor'], string> = {
  valhalla: 'Valhalla',
  brouter: 'BRouter',
  mapas: 'Mapas Bogotá',
  offline: 'Local',
};

function porId<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error(`Falta el elemento #${id}`);
  return elemento as T;
}

const prefs = cargarPreferencias();
const sesion = cargarSesion();

let origen: Lugar | undefined = sesion.origen;
let destino: Lugar | undefined = sesion.destino;
let conjunto: ConjuntoRutas | null = null;
let rutaActiva: RutaBici | null = null;
let modoMapa: 'origen' | 'destino' | null = null;
let cargando = false;
let controlador: AbortController | null = null;
let temporizadorAviso = 0;
let temporizadorToast = 0;
const temporizadoresBusqueda: Record<'origen' | 'destino', number | undefined> = {
  origen: undefined,
  destino: undefined,
};
const abortadoresBusqueda: Record<'origen' | 'destino', AbortController | null> = {
  origen: null,
  destino: null,
};

const entradaOrigen = porId<HTMLInputElement>('entrada-origen');
const entradaDestino = porId<HTMLInputElement>('entrada-destino');
const sugerenciasOrigen = porId<HTMLUListElement>('sugerencias-origen');
const sugerenciasDestino = porId<HTMLUListElement>('sugerencias-destino');
const botonOrigenMapa = porId<HTMLButtonElement>('btn-origen-mapa');
const botonDestinoMapa = porId<HTMLButtonElement>('btn-destino-mapa');
const botonOrigenUbicacion = porId<HTMLButtonElement>('btn-origen-ubicacion');
const botonComparar = porId<HTMLButtonElement>('btn-comparar');
const textoBotonComparar = botonComparar.querySelector<HTMLElement>('.texto-boton')!;
const girador = botonComparar.querySelector<HTMLElement>('.girador')!;
const estadoApp = porId<HTMLElement>('estado-app');
const estadoTexto = porId<HTMLElement>('estado-texto');
const zonaResultados = porId<HTMLElement>('zona-resultados');
const tarjetas = porId<HTMLElement>('tarjetas');
const detalleRuta = porId<HTMLElement>('detalle-ruta');
const alternativas = porId<HTMLElement>('alternativas');
const listaFuentes = porId<HTMLElement>('lista-fuentes');
const chipConexion = porId<HTMLElement>('chip-conexion');
const textoConexion = porId<HTMLElement>('texto-conexion');
const selectOffline = porId<HTMLSelectElement>('select-offline');
const offlineEstado = porId<HTMLElement>('offline-estado');
const progresoOffline = porId<HTMLElement>('progreso-offline');
const barraProgreso = progresoOffline.querySelector<HTMLElement>('.barra span')!;
const textoProgreso = progresoOffline.querySelector<HTMLElement>('small')!;
const chkCiclorrutas = porId<HTMLInputElement>('chk-ciclorrutas');
const chkVectorial = porId<HTMLInputElement>('chk-vectorial');
const avisoMapa = porId<HTMLElement>('aviso-mapa');
const modoMapaElemento = porId<HTMLElement>('modo-mapa');
const modoMapaTexto = porId<HTMLElement>('modo-mapa-texto');
const dialogoAcerca = porId<HTMLDialogElement>('dialogo-acerca');
const toastElemento = porId<HTMLElement>('toast');

const mapa = new MapaViaje({
  contenedor: porId<HTMLElement>('mapa'),
  tema: prefs.tema,
  alHacerClic: (lat, lon) => alHacerClicMapa(lat, lon),
  alMoverMarcador: (tipo, lat, lon) => alMoverMarcador(tipo, lat, lon),
  alCambiarCapa: (mensaje) => mostrarAvisoMapa(mensaje),
});

function setEstado(texto: string, tipo: 'error' | 'exito' | 'aviso' | '' = ''): void {
  estadoTexto.textContent = texto;
  estadoApp.dataset.tipo = tipo;
}

function toast(mensaje: string, tipo: 'error' | 'exito' | '' = ''): void {
  clearTimeout(temporizadorToast);
  toastElemento.textContent = mensaje;
  toastElemento.dataset.tipo = tipo;
  toastElemento.hidden = false;
  temporizadorToast = window.setTimeout(() => {
    toastElemento.hidden = true;
  }, 6000);
}

function mostrarAvisoMapa(mensaje: string): void {
  clearTimeout(temporizadorAviso);
  avisoMapa.textContent = mensaje;
  avisoMapa.hidden = false;
  temporizadorAviso = window.setTimeout(() => {
    avisoMapa.hidden = true;
  }, 3500);
}

function actualizarChipConexion(): void {
  const enLinea = navigator.onLine;
  chipConexion.classList.toggle('chip-online', enLinea);
  chipConexion.classList.toggle('chip-offline', !enLinea);
  textoConexion.textContent = enLinea ? 'En línea' : 'Sin conexión';
  chipConexion.title = enLinea
    ? 'Conexión disponible: se consultan los motores en línea'
    : 'Sin conexión: se usará el motor local';
}

function lugarActual(tipo: 'origen' | 'destino'): Lugar | undefined {
  return tipo === 'origen' ? origen : destino;
}

function setLugar(tipo: 'origen' | 'destino', lugar: Lugar | undefined, actualizarMapa = true): void {
  const entrada = tipo === 'origen' ? entradaOrigen : entradaDestino;
  if (tipo === 'origen') origen = lugar;
  else destino = lugar;

  entrada.value = lugar?.etiqueta ?? '';
  if (actualizarMapa) {
    if (tipo === 'origen') mapa.setOrigen(lugar);
    else mapa.setDestino(lugar);
  }
  guardarSesion({ origen, destino, perfil: prefs.ultimoPerfil });
  ocultarSugerencias(tipo);
}

function olvidarLugar(tipo: 'origen' | 'destino'): void {
  if (tipo === 'origen') {
    origen = undefined;
    mapa.setOrigen(undefined);
  } else {
    destino = undefined;
    mapa.setDestino(undefined);
  }
  guardarSesion({ origen, destino, perfil: prefs.ultimoPerfil });
}

function invalidarResultados(mensaje = 'Puntos actualizados. Compara de nuevo las rutas.'): void {
  if (!conjunto && !rutaActiva) return;
  conjunto = null;
  rutaActiva = null;
  zonaResultados.hidden = true;
  mapa.limpiarRutas();
  setEstado(mensaje, 'aviso');
}

function aplicarTema(): void {
  document.documentElement.dataset.tema = prefs.tema;
  mapa.setTema(prefs.tema);
  const boton = porId<HTMLButtonElement>('btn-tema');
  boton.setAttribute(
    'aria-label',
    prefs.tema === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
  );
  boton.title = prefs.tema === 'oscuro' ? 'Tema claro' : 'Tema oscuro';
}

function configurarBuscador(tipo: 'origen' | 'destino'): void {
  const entrada = tipo === 'origen' ? entradaOrigen : entradaDestino;
  const lista = tipo === 'origen' ? sugerenciasOrigen : sugerenciasDestino;

  entrada.addEventListener('input', () => {
    const actual = lugarActual(tipo);
    if (actual && entrada.value.trim() !== actual.etiqueta) {
      // El texto escrito se conserva: solo se olvida el punto ya fijado.
      olvidarLugar(tipo);
      invalidarResultados();
    }
    if (entrada.value.trim().length < 3) {
      ocultarSugerencias(tipo);
      return;
    }
    programarBusqueda(tipo);
  });

  entrada.addEventListener('focus', () => {
    if (entrada.value.trim().length >= 3 && lista.children.length) lista.hidden = false;
  });

  entrada.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      ocultarSugerencias(tipo);
      entrada.blur();
    }
    if (evento.key === 'ArrowDown') {
      const primerBoton = lista.querySelector<HTMLButtonElement>('button');
      if (primerBoton) {
        evento.preventDefault();
        lista.hidden = false;
        primerBoton.focus();
      }
    }
  });

  entrada.addEventListener('blur', () => {
    window.setTimeout(() => {
      lista.hidden = true;
    }, 160);
  });
}

function programarBusqueda(tipo: 'origen' | 'destino'): void {
  clearTimeout(temporizadoresBusqueda[tipo]);
  temporizadoresBusqueda[tipo] = window.setTimeout(() => void ejecutarBusqueda(tipo), 420);
}

async function ejecutarBusqueda(tipo: 'origen' | 'destino'): Promise<void> {
  const entrada = tipo === 'origen' ? entradaOrigen : entradaDestino;
  const lista = tipo === 'origen' ? sugerenciasOrigen : sugerenciasDestino;
  const consulta = entrada.value.trim();
  if (consulta.length < 3) return;

  abortadoresBusqueda[tipo]?.abort();
  const controladorBusqueda = new AbortController();
  abortadoresBusqueda[tipo] = controladorBusqueda;
  lista.innerHTML = '<li class="sin-resultados" role="status">Buscando en Bogotá…</li>';
  lista.hidden = false;

  try {
    const resultados = await buscarLugares(consulta, controladorBusqueda.signal);
    if (controladorBusqueda.signal.aborted) return;
    if (entrada.value.trim() !== consulta) return;
    if (!resultados.length) {
      lista.innerHTML =
        '<li class="sin-resultados" role="status">No encontré ese lugar. Prueba con una dirección o un punto del mapa.</li>';
      return;
    }
    lista.innerHTML = resultados
      .map(
        (lugar, indice) =>
          `<li role="option"><button type="button" data-indice="${indice}"><strong>${escaparHtml(
            lugar.etiqueta,
          )}</strong><small>${lugar.lat.toFixed(5)}, ${lugar.lon.toFixed(5)}</small></button></li>`,
      )
      .join('');
    lista.querySelectorAll<HTMLButtonElement>('button').forEach((boton, indice) => {
      boton.addEventListener('click', () => {
        elegirLugar(tipo, resultados[indice]);
      });
    });
    lista.hidden = false;
  } catch (error) {
    if (controladorBusqueda.signal.aborted) return;
    lista.innerHTML = `<li class="sin-resultados" role="status">No se pudo buscar: ${escaparHtml(
      mensajeError(error),
    )}</li>`;
  }
}

function ocultarSugerencias(tipo: 'origen' | 'destino'): void {
  const lista = tipo === 'origen' ? sugerenciasOrigen : sugerenciasDestino;
  lista.hidden = true;
}

function elegirLugar(tipo: 'origen' | 'destino', lugar: Lugar): void {
  setLugar(tipo, lugar);
  invalidarResultados();
  if (origen && destino) {
    mapa.mapa.fitBounds(
      [
        [origen.lat, origen.lon],
        [destino.lat, destino.lon],
      ],
      { padding: [60, 60], maxZoom: 15, duration: 0.6 },
    );
  } else {
    mapa.mapa.flyTo([lugar.lat, lugar.lon], 15, { duration: 0.6 });
  }
  setEstado(
    tipo === 'origen'
      ? 'Origen fijado. Elige el destino o compara si ya lo tienes.'
      : 'Destino fijado. Pulsa «Comparar rutas».',
  );
  if (tipo === 'origen') entradaDestino.focus();
}

function alternarModoMapa(tipo: 'origen' | 'destino'): void {
  modoMapa = modoMapa === tipo ? null : tipo;
  actualizarModoMapa();
  if (modoMapa) {
    setEstado(
      `Haz clic en el mapa para fijar el ${tipo}. También puedes arrastrar los marcadores.`,
      'aviso',
    );
  }
}

function actualizarModoMapa(): void {
  botonOrigenMapa.classList.toggle('activo', modoMapa === 'origen');
  botonDestinoMapa.classList.toggle('activo', modoMapa === 'destino');
  botonOrigenMapa.setAttribute('aria-pressed', String(modoMapa === 'origen'));
  botonDestinoMapa.setAttribute('aria-pressed', String(modoMapa === 'destino'));
  modoMapaElemento.hidden = !modoMapa;
  if (modoMapa) {
    modoMapaTexto.textContent =
      modoMapa === 'origen' ? 'Selecciona el origen en el mapa' : 'Selecciona el destino en el mapa';
  }
}

async function alHacerClicMapa(lat: number, lon: number): Promise<void> {
  if (!modoMapa) return;
  const tipo = modoMapa;
  const provisional: Lugar = {
    etiqueta: `Punto en el mapa (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
    lat,
    lon,
  };
  setLugar(tipo, provisional);
  invalidarResultados();
  modoMapa = null;
  actualizarModoMapa();

  if (navigator.onLine) {
    try {
      const etiqueta = await describirPunto(lat, lon);
      const actual = lugarActual(tipo);
      if (actual && actual.lat === lat && actual.lon === lon) {
        setLugar(tipo, { ...actual, etiqueta });
      }
    } catch {
      // Conservar la etiqueta con coordenadas.
    }
  }
  setEstado(`${tipo === 'origen' ? 'Origen' : 'Destino'} fijado en el mapa.`);
}

async function alMoverMarcador(tipo: 'origen' | 'destino', lat: number, lon: number): Promise<void> {
  const provisional: Lugar = {
    etiqueta: `Punto en el mapa (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
    lat,
    lon,
  };
  setLugar(tipo, provisional);
  invalidarResultados();
  if (navigator.onLine) {
    try {
      const etiqueta = await describirPunto(lat, lon);
      const actual = lugarActual(tipo);
      if (actual && actual.lat === lat && actual.lon === lon) {
        setLugar(tipo, { ...actual, etiqueta });
      }
    } catch {
      // Conservar coordenadas.
    }
  }
}

function setCargando(activo: boolean): void {
  cargando = activo;
  botonComparar.disabled = activo;
  textoBotonComparar.textContent = activo ? 'Calculando rutas…' : 'Comparar rutas';
  girador.hidden = !activo;
  zonaResultados.setAttribute('aria-busy', String(activo));
}

function rutaPorPerfil(perfil: PerfilRuta): RutaBici | null {
  if (!conjunto) return null;
  return conjunto[perfil];
}

function seleccionarRuta(ruta: RutaBici): void {
  rutaActiva = ruta;
  if (ruta.perfil) {
    prefs.ultimoPerfil = ruta.perfil;
    guardarPreferencias(prefs);
  }
  renderTarjetas();
  renderDetalle(ruta);
  dibujarConjunto();
  if (origen && destino) guardarUltimaRuta(ruta, origen, destino);
}

function dibujarConjunto(): void {
  if (!conjunto) return;
  mapa.dibujarRutas(
    [conjunto.rapida, conjunto.corta, conjunto.segura, ...conjunto.alternativas],
    rutaActiva?.id ?? null,
  );
}

function renderTarjetas(): void {
  if (!conjunto) {
    tarjetas.innerHTML = '';
    return;
  }
  tarjetas.innerHTML = PERFILES.map(({ id, nombre }) => {
    const ruta = conjunto![id];
    const seleccionada = rutaActiva?.id === ruta.id;
    const insignia = ruta.proveedor === 'offline' ? 'offline' : PROVEEDOR_CORTO[ruta.proveedor];
    return `<button type="button" class="tarjeta${seleccionada ? ' seleccionada' : ''}" data-perfil="${id}" aria-pressed="${seleccionada}" title="${escaparHtml(
      `${nombre}: ${formatearDistancia(ruta.distanciaM)}, ${formatearDuracion(ruta.duracionS)} · ${ruta.proveedorEtiqueta}`,
    )}">
      <span class="nombre">${nombre}</span>
      <span class="tiempo">${formatearDuracion(ruta.duracionS)}</span>
      <span class="distancia">${formatearDistancia(ruta.distanciaM)}</span>
      <span class="fuente">${escaparHtml(ruta.proveedorEtiqueta)}</span>
      <span class="insignia">${escaparHtml(insignia)}</span>
    </button>`;
  }).join('');

  tarjetas.querySelectorAll<HTMLButtonElement>('.tarjeta').forEach((boton) => {
    boton.addEventListener('click', () => {
      const perfil = boton.dataset.perfil as PerfilRuta;
      const ruta = rutaPorPerfil(perfil);
      if (ruta) seleccionarRuta(ruta);
    });
  });
}

function renderDetalle(ruta: RutaBici): void {
  const nombre = ruta.perfil
    ? (PERFILES.find((p) => p.id === ruta.perfil)?.nombre ?? 'Ruta')
    : 'Alternativa';
  const metricas: string[] = [
    `<div class="metrica"><span>Distancia</span><strong>${formatearDistancia(ruta.distanciaM)}</strong></div>`,
    `<div class="metrica"><span>Duración</span><strong>${formatearDuracion(ruta.duracionS)}</strong></div>`,
  ];
  if (typeof ruta.ascensoM === 'number' && ruta.ascensoM > 0) {
    metricas.push(
      `<div class="metrica"><span>Ascenso</span><strong>${Math.round(ruta.ascensoM)} m</strong></div>`,
    );
  }
  if (typeof ruta.seguridad === 'number') {
    metricas.push(
      `<div class="metrica"><span>Estrés</span><strong>${ruta.seguridad.toFixed(1)}/10</strong></div>`,
    );
  }

  const pasos = ruta.pasos.length
    ? ruta.pasos
        .filter((paso) => paso.instruccion)
        .map(
          (paso, indice) => `<li>
            <span class="numero">${indice + 1}</span>
            <span class="texto">${escaparHtml(paso.instruccion)}</span>
            <span class="distancia">${paso.distanciaM > 0 ? formatearDistancia(paso.distanciaM) : ''}</span>
          </li>`,
        )
        .join('')
    : '<li><span class="numero">1</span><span class="texto">Sigue el trazado dibujado en el mapa.</span></li>';

  const advertencias = ruta.advertencias?.length
    ? `<ul class="advertencias">${ruta.advertencias
        .map((texto) => `<li>${escaparHtml(texto)}</li>`)
        .join('')}</ul>`
    : '';

  const enlaceMapas =
    origen && destino
      ? `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lon}&destination=${destino.lat},${destino.lon}&travelmode=bicycling`
      : '#';

  detalleRuta.innerHTML = `<div class="detalle-cabecera">
      <div>
        <h2>${nombre}</h2>
        <p>${escaparHtml(ruta.proveedorEtiqueta)}${ruta.perfilMotor ? ` · ${escaparHtml(ruta.perfilMotor)}` : ''}</p>
      </div>
    </div>
    <div class="metricas">${metricas.join('')}</div>
    <ol class="pasos" aria-label="Indicaciones de la ruta">${pasos}</ol>
    ${advertencias}
    <div class="detalle-pie">
      <a href="${enlaceMapas}" target="_blank" rel="noopener">Abrir en Google Maps</a>
      <button type="button" class="boton-texto" id="btn-centrar-ruta">Centrar en el mapa</button>
    </div>`;

  detalleRuta.querySelector<HTMLButtonElement>('#btn-centrar-ruta')?.addEventListener('click', () => {
    mapa.ajustarRuta(ruta.geometria);
  });
}

function renderAlternativas(): void {
  if (!conjunto || !conjunto.alternativas.length) {
    alternativas.innerHTML = '';
    return;
  }
  alternativas.innerHTML = `<h3>Otras alternativas</h3>${conjunto.alternativas
    .map(
      (ruta, indice) => `<button type="button" class="alternativa" data-indice="${indice}">
        <span>
          <strong>${escaparHtml(ruta.proveedorEtiqueta)}</strong>
          <small>${escaparHtml(ruta.perfilMotor ?? 'Alternativa')}</small>
        </span>
        <span class="datos">${formatearDistancia(ruta.distanciaM)} · ${formatearDuracion(ruta.duracionS)}</span>
      </button>`,
    )
    .join('')}`;
  alternativas.querySelectorAll<HTMLButtonElement>('.alternativa').forEach((boton) => {
    boton.addEventListener('click', () => {
      const indice = Number(boton.dataset.indice);
      const ruta = conjunto?.alternativas[indice];
      if (ruta) seleccionarRuta(ruta);
    });
  });
}

function renderFuentes(): void {
  if (!conjunto) {
    listaFuentes.innerHTML = '';
    return;
  }
  listaFuentes.innerHTML = `<ul>${conjunto.fuentes
    .map(
      (fuente) => `<li>
        <span class="${fuente.ok ? '' : 'fallo'}">${fuente.ok ? '✓' : '✕'} ${escaparHtml(fuente.nombre)}</span>
        <span>${escaparHtml(fuente.detalle)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function renderResultados(): void {
  zonaResultados.hidden = false;
  renderTarjetas();
  if (rutaActiva) renderDetalle(rutaActiva);
  renderAlternativas();
  renderFuentes();
}

async function comparar(forzarOffline?: boolean): Promise<void> {
  if (cargando) return;
  if (!origen || !destino) {
    setEstado('Necesitas un origen y un destino para comparar.', 'error');
    if (!origen) entradaOrigen.focus();
    else entradaDestino.focus();
    return;
  }
  if (origen.lat === destino.lat && origen.lon === destino.lon) {
    setEstado('El origen y el destino son el mismo punto.', 'error');
    return;
  }

  const usarOffline =
    forzarOffline ??
    (prefs.modoOffline === 'siempre' || (prefs.modoOffline === 'auto' && !navigator.onLine));

  controlador?.abort();
  controlador = new AbortController();
  setCargando(true);
  setEstado(
    usarOffline
      ? 'Calculando en el dispositivo con el grafo local de OpenStreetMap…'
      : 'Consultando Valhalla, BRouter y Mapas Bogotá…',
  );
  const inicio = performance.now();

  try {
    const resultado = await compararRutas({
      origen,
      destino,
      usarOffline,
      signal: controlador.signal,
    });
    conjunto = resultado;
    rutaActiva = resultado[prefs.ultimoPerfil] ?? resultado.rapida;
    renderResultados();
    dibujarConjunto();
    mapa.ajustarRuta(rutaActiva.geometria);
    guardarSesion({ origen, destino, perfil: prefs.ultimoPerfil });
    if (origen && destino) guardarUltimaRuta(rutaActiva, origen, destino);
    const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
    setEstado(
      resultado.offline
        ? `Rutas calculadas sin conexión en ${segundos} s.`
        : `Rutas comparadas en ${segundos} s con ${resultado.fuentes.filter((f) => f.ok).length} fuentes en línea.`,
      'exito',
    );
    if (resultado.avisos.some((aviso) => aviso.includes('fallaron'))) {
      toast('Algunos servicios no respondieron; se usó el motor local como respaldo.', 'error');
    }
    if (window.matchMedia('(max-width: 900px)').matches) {
      zonaResultados.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (error) {
    if (controlador.signal.aborted) {
      setEstado('Consulta cancelada.');
      return;
    }
    setEstado(`No se pudo calcular la ruta: ${mensajeError(error)}`, 'error');
    toast(mensajeError(error), 'error');
  } finally {
    setCargando(false);
  }
}

function limpiarTodo(): void {
  controlador?.abort();
  origen = undefined;
  destino = undefined;
  conjunto = null;
  rutaActiva = null;
  entradaOrigen.value = '';
  entradaDestino.value = '';
  mapa.setOrigen(undefined);
  mapa.setDestino(undefined);
  mapa.limpiarRutas();
  zonaResultados.hidden = true;
  mapa.verBogota();
  guardarSesion({ perfil: prefs.ultimoPerfil });
  setEstado('Elige un origen y un destino para empezar.');
  entradaOrigen.focus();
}

function cargarEjemplo(): void {
  setLugar('origen', {
    etiqueta: 'Parque de la 93, Bogotá',
    lat: 4.6767,
    lon: -74.0483,
  });
  setLugar('destino', {
    etiqueta: 'Plaza de Bolívar, Bogotá',
    lat: 4.5981,
    lon: -74.076,
  });
  mapa.mapa.fitBounds(
    [
      [4.6767, -74.0483],
      [4.5981, -74.076],
    ],
    { padding: [60, 60], maxZoom: 15, duration: 0.6 },
  );
  setEstado('Ejemplo cargado: Parque de la 93 → Plaza de Bolívar.');
  void comparar();
}

async function usarUbicacion(): Promise<void> {
  botonOrigenUbicacion.disabled = true;
  setEstado('Obteniendo tu ubicación…');
  try {
    const lugar = await obtenerUbicacion();
    elegirLugar('origen', lugar);
    setEstado('Origen fijado en tu ubicación. Elige el destino.');
  } catch (error) {
    setEstado(mensajeError(error), 'error');
    toast(mensajeError(error), 'error');
  } finally {
    botonOrigenUbicacion.disabled = false;
  }
}

async function actualizarEstadoOffline(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      offlineEstado.textContent = 'Incluido en la app';
      offlineEstado.title = 'El mapa vectorial, las ciclorrutas y el grafo de ruteo viajan dentro del APK.';
      return;
    }
  } catch {
    // Sin Capacitor (web normal): se comprueba la caché del navegador.
  }
  try {
    const estado = await verificarPaqueteOffline();
    if (!estado.soportado) {
      offlineEstado.textContent = 'Incluido en la app';
      return;
    }
    offlineEstado.textContent = estado.completo
      ? `Listo · ${estado.archivos}/${estado.total}`
      : `${estado.archivos}/${estado.total} archivos`;
    offlineEstado.title = estado.completo
      ? 'Mapa, ciclorrutas y grafo de ruteo guardados en este dispositivo'
      : 'Pulsa «Preparar datos» para guardar todos los datos';
  } catch {
    offlineEstado.textContent = 'No disponible';
  }
}

async function prepararOffline(): Promise<void> {
  const boton = porId<HTMLButtonElement>('btn-preparar-offline');
  boton.disabled = true;
  progresoOffline.hidden = false;
  barraProgreso.style.width = '0%';
  textoProgreso.textContent = 'Preparando…';
  try {
    const estado = await prepararPaqueteOffline(({ hechos, total, archivo }) => {
      const porcentaje = Math.round((hechos / total) * 100);
      barraProgreso.style.width = `${porcentaje}%`;
      textoProgreso.textContent = `${porcentaje}% · ${archivo.split('/').pop()}`;
    });
    barraProgreso.style.width = '100%';
    textoProgreso.textContent = `Listo: ${estado.archivos}/${estado.total} archivos guardados.`;
    offlineEstado.textContent = `Listo · ${estado.archivos}/${estado.total}`;
    toast('Datos sin conexión preparados.', 'exito');
    // Mostrar el tamaño aproximado de los datos descargados.
    try {
      const respuesta = await fetch(new URL('data/grafo-bogota.meta.json', document.baseURI));
      if (respuesta.ok) {
        const meta = (await respuesta.json()) as { bytesGrafo?: number; nodos?: number };
        if (meta.nodos) {
          setEstado(
            `Motor local con ${meta.nodos.toLocaleString('es-CO')} nodos; datos de ${tamanoLegible(
              meta.bytesGrafo ?? 0,
            )} comprimidos.`,
            'exito',
          );
        }
      }
    } catch {
      // El tamaño es informativo.
    }
  } catch (error) {
    textoProgreso.textContent = mensajeError(error);
    toast(mensajeError(error), 'error');
  } finally {
    boton.disabled = false;
  }
}

async function probarMotorLocal(): Promise<void> {
  const boton = porId<HTMLButtonElement>('btn-probar-offline');
  boton.disabled = true;
  setEstado('Cargando el grafo ciclable local…');
  try {
    const info = await precargarOffline();
    setEstado(
      `Motor local listo: ${info.nodos.toLocaleString('es-CO')} nodos y ${info.aristas.toLocaleString(
        'es-CO',
      )} aristas. Selecciona «Siempre sin conexión» o pulsa Comparar sin red.`,
      'exito',
    );
    toast('Grafo offline cargado correctamente.', 'exito');
    if (origen && destino) {
      await comparar(true);
    }
  } catch (error) {
    setEstado(`No se pudo cargar el motor local: ${mensajeError(error)}`, 'error');
    toast(mensajeError(error), 'error');
  } finally {
    boton.disabled = false;
  }
}

async function alternarCiclorrutas(visible: boolean): Promise<void> {
  try {
    await mapa.setCiclorrutas(visible);
  } catch (error) {
    chkCiclorrutas.checked = false;
    prefs.mostrarCiclorrutas = false;
    guardarPreferencias(prefs);
    toast(mensajeError(error), 'error');
  }
}

async function alternarMapaVectorial(visible: boolean): Promise<void> {
  try {
    await mapa.setMapaVectorial(visible);
  } catch (error) {
    chkVectorial.checked = false;
    prefs.mapaVectorial = false;
    guardarPreferencias(prefs);
    toast(mensajeError(error), 'error');
  }
}

function actualizarSegunConexion(): void {
  actualizarChipConexion();
  if (!navigator.onLine) {
    setEstado('Estás sin conexión. Se usará el motor local al comparar.', 'aviso');
    if (prefs.modoOffline === 'auto' && !prefs.mapaVectorial) {
      prefs.mapaVectorial = true;
      chkVectorial.checked = true;
      guardarPreferencias(prefs);
      void alternarMapaVectorial(true);
    }
  } else {
    setEstado('Conexión restablecida. Puedes comparar con los motores en línea.');
  }
}

function inicializar(): void {
  document.documentElement.dataset.tema = prefs.tema;
  porId<HTMLElement>('version-app').textContent = APP.version;
  porId<HTMLAnchorElement>('enlace-repositorio').href = APP.repositorio;

  if (origen) setLugar('origen', origen, false);
  if (destino) setLugar('destino', destino, false);
  if (origen) mapa.setOrigen(origen);
  if (destino) mapa.setDestino(destino);
  if (origen && destino) {
    mapa.mapa.fitBounds(
      [
        [origen.lat, origen.lon],
        [destino.lat, destino.lon],
      ],
      { padding: [60, 60], maxZoom: 14 },
    );
    setEstado('Ruta anterior restaurada. Pulsa «Comparar rutas» para actualizarla.');
  }

  selectOffline.value = prefs.modoOffline;
  chkCiclorrutas.checked = prefs.mostrarCiclorrutas;
  chkVectorial.checked = prefs.mapaVectorial;
  aplicarTema();
  actualizarChipConexion();
  void actualizarEstadoOffline();

  if (prefs.mostrarCiclorrutas) void alternarCiclorrutas(true);
  if (prefs.mapaVectorial || (prefs.modoOffline === 'auto' && !navigator.onLine)) {
    chkVectorial.checked = true;
    void alternarMapaVectorial(true);
  }

  configurarBuscador('origen');
  configurarBuscador('destino');

  botonOrigenMapa.addEventListener('click', () => alternarModoMapa('origen'));
  botonDestinoMapa.addEventListener('click', () => alternarModoMapa('destino'));
  porId<HTMLButtonElement>('btn-cancelar-modo').addEventListener('click', () => {
    modoMapa = null;
    actualizarModoMapa();
    setEstado('Selección en el mapa cancelada.');
  });
  botonOrigenUbicacion.addEventListener('click', () => void usarUbicacion());
  botonComparar.addEventListener('click', () => void comparar());
  porId<HTMLButtonElement>('btn-limpiar').addEventListener('click', limpiarTodo);
  porId<HTMLButtonElement>('btn-ejemplo').addEventListener('click', cargarEjemplo);
  porId<HTMLButtonElement>('btn-intercambiar').addEventListener('click', () => {
    const anteriorOrigen = origen;
    const anteriorDestino = destino;
    setLugar('origen', anteriorDestino);
    setLugar('destino', anteriorOrigen);
    invalidarResultados('Origen y destino intercambiados. Compara de nuevo.');
    if (origen && destino) {
      mapa.mapa.fitBounds(
        [
          [origen.lat, origen.lon],
          [destino.lat, destino.lon],
        ],
        { padding: [60, 60], maxZoom: 15, duration: 0.6 },
      );
    }
  });

  porId<HTMLButtonElement>('btn-tema').addEventListener('click', () => {
    prefs.tema = prefs.tema === 'claro' ? 'oscuro' : 'claro';
    guardarPreferencias(prefs);
    aplicarTema();
  });
  porId<HTMLButtonElement>('btn-acerca').addEventListener('click', () => {
    dialogoAcerca.showModal();
  });
  dialogoAcerca.addEventListener('click', (evento) => {
    if (evento.target === dialogoAcerca) dialogoAcerca.close();
  });

  selectOffline.addEventListener('change', () => {
    prefs.modoOffline = selectOffline.value as typeof prefs.modoOffline;
    guardarPreferencias(prefs);
    if (prefs.modoOffline === 'siempre' && !prefs.mapaVectorial) {
      prefs.mapaVectorial = true;
      chkVectorial.checked = true;
      void alternarMapaVectorial(true);
    }
    setEstado(
      prefs.modoOffline === 'siempre'
        ? 'Modo sin conexión forzado: se usará el motor local.'
        : prefs.modoOffline === 'nunca'
          ? 'Solo se consultarán los motores en línea.'
          : 'Modo automático: sin red se usará el motor local.',
    );
  });

  chkCiclorrutas.addEventListener('change', () => {
    prefs.mostrarCiclorrutas = chkCiclorrutas.checked;
    guardarPreferencias(prefs);
    void alternarCiclorrutas(chkCiclorrutas.checked);
  });

  chkVectorial.addEventListener('change', () => {
    prefs.mapaVectorial = chkVectorial.checked;
    guardarPreferencias(prefs);
    void alternarMapaVectorial(chkVectorial.checked);
  });

  porId<HTMLButtonElement>('btn-preparar-offline').addEventListener('click', () => void prepararOffline());
  porId<HTMLButtonElement>('btn-probar-offline').addEventListener('click', () => void probarMotorLocal());

  window.addEventListener('online', actualizarSegunConexion);
  window.addEventListener('offline', actualizarSegunConexion);
  window.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && modoMapa) {
      modoMapa = null;
      actualizarModoMapa();
    }
  });

  window.setTimeout(() => mapa.invalidarTamano(), 80);
  window.addEventListener('resize', () => mapa.invalidarTamano());

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.warn('No se pudo registrar el service worker:', error);
      });
    });
  }
}

inicializar();
