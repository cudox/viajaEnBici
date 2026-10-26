export function formatearDistancia(metros: number): string {
  if (!Number.isFinite(metros)) return '—';
  if (metros < 1000) return `${Math.round(metros / 10) * 10} m`;
  const km = metros / 1000;
  return `${km.toFixed(km < 100 ? 1 : 0)} km`;
}

export function formatearDuracion(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '—';
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatearFecha(iso: string | number | Date): string {
  const fecha = iso instanceof Date ? iso : new Date(iso);
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(fecha);
}

export function formatearCoordenada(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function escaparHtml(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c,
  );
}

export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
