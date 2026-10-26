export class ErrorServicio extends Error {
  constructor(
    public readonly servicio: string,
    message: string,
    public readonly estado?: number,
    public readonly detalle?: unknown,
  ) {
    super(message);
    this.name = 'ErrorServicio';
  }
}

interface OpcionesPeticion extends RequestInit {
  tiempoMaximoMs?: number;
  signal?: AbortSignal;
}

/**
 * Petición JSON con tiempo máximo y cancelación externa. No oculta errores:
 * distingue HTTP, red/DNS, tiempo de espera y respuestas no JSON.
 */
export async function pedirJson<T>(url: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const { tiempoMaximoMs = 25_000, signal, ...init } = opciones;
  const controlador = new AbortController();
  const temporizador = setTimeout(() => {
    controlador.abort(new DOMException('Tiempo de espera agotado', 'TimeoutError'));
  }, tiempoMaximoMs);
  const alCancelar = () => controlador.abort(signal?.reason);
  signal?.addEventListener('abort', alCancelar, { once: true });

  try {
    const respuesta = await fetch(url, { ...init, signal: controlador.signal });
    if (!respuesta.ok) {
      const texto = await respuesta.text().catch(() => '');
      throw new ErrorServicio(
        'HTTP',
        `El servidor respondió ${respuesta.status} ${respuesta.statusText}`,
        respuesta.status,
        texto.slice(0, 300),
      );
    }
    const tipo = respuesta.headers.get('content-type') ?? '';
    if (!tipo.includes('json') && !tipo.includes('geo+json')) {
      const texto = await respuesta.text().catch(() => '');
      throw new ErrorServicio('Formato', 'La respuesta no es JSON', respuesta.status, texto.slice(0, 300));
    }
    return (await respuesta.json()) as T;
  } catch (error) {
    if (error instanceof ErrorServicio) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ErrorServicio('Tiempo', 'El servicio no respondió a tiempo.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ErrorServicio('Cancelado', 'Consulta cancelada.');
    }
    const mensaje = error instanceof Error ? error.message : String(error);
    throw new ErrorServicio('Red', `No se pudo conectar con el servicio: ${mensaje}`);
  } finally {
    clearTimeout(temporizador);
    signal?.removeEventListener('abort', alCancelar);
  }
}

export function mensajeError(error: unknown): string {
  if (error instanceof ErrorServicio) {
    if (error.estado) return `${error.message} (${error.servicio} ${error.estado})`;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
