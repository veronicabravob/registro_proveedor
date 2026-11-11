import type { Caso, EventoTurno, Llamada, RespuestaChat, Salud, Sesion } from "./tipos.ts"

/** Error de la API con un mensaje ya apto para mostrar a la analista. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje)
  }
}

const CLAVE_ALMACEN = "rp.claveAcceso"

function leerClave(): string {
  try {
    return localStorage.getItem(CLAVE_ALMACEN) ?? ""
  } catch {
    return ""
  }
}

export function guardarClave(clave: string): void {
  try {
    localStorage.setItem(CLAVE_ALMACEN, clave)
  } catch {
    /* sin almacenamiento: la clave vive solo en esta pestaña */
  }
}

let claveEnMemoria = leerClave()
export const fijarClave = (clave: string): void => {
  claveEnMemoria = clave
  guardarClave(clave)
}

function cabeceras(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, ...(claveEnMemoria ? { "x-access-key": claveEnMemoria } : {}) }
}

const MENSAJES: Record<number, string> = {
  401: "Necesito la clave de acceso para continuar.",
  409: "Todavía estoy trabajando en tu mensaje anterior.",
  413: "El mensaje es demasiado largo.",
  429: "Hiciste muchas solicitudes seguidas. Espera un minuto e intenta de nuevo.",
  503: "El asistente no está disponible en este momento.",
}

async function errorDe(r: Response): Promise<ErrorApi> {
  const cuerpo = (await r.json().catch(() => null)) as { error?: string } | null
  return new ErrorApi(r.status, cuerpo?.error ?? MENSAJES[r.status] ?? "Algo salió mal. Intenta de nuevo.")
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(ruta, { ...init, headers: cabeceras(init?.headers as Record<string, string> | undefined) })
  if (!r.ok) throw await errorDe(r)
  return (await r.json()) as T
}

export const api = {
  salud: () => pedir<Salud>("/api/health"),
  casos: () => pedir<{ casos: Caso[] }>("/api/casos").then((r) => r.casos),
  sesion: (id: string) => pedir<Sesion>(`/api/sessions/${encodeURIComponent(id)}`),

  /** Descarga un archivo generado (out/...) respetando la clave de acceso. */
  async descargar(ruta: string): Promise<void> {
    const r = await fetch(`/api/archivos/${ruta}`, { headers: cabeceras() })
    if (!r.ok) throw await errorDe(r)
    const url = URL.createObjectURL(await r.blob())
    const a = Object.assign(document.createElement("a"), { href: url, download: ruta.split("/").pop() ?? "archivo" })
    a.click()
    URL.revokeObjectURL(url)
  },

  /**
   * Envía un mensaje y recibe el avance en vivo (Server-Sent Events sobre POST).
   * Cada evento se entrega a `alEvento`; la promesa resuelve con la respuesta final.
   */
  async conversar(
    cuerpo: { sessionId?: string; message: string; confirm?: boolean },
    alEvento: (e: EventoTurno) => void,
    senal?: AbortSignal,
  ): Promise<RespuestaChat> {
    const r = await fetch("/api/chat/stream", {
      method: "POST",
      headers: cabeceras({ "Content-Type": "application/json", Accept: "text/event-stream" }),
      body: JSON.stringify(cuerpo),
      ...(senal ? { signal: senal } : {}),
    })
    if (!r.ok || !r.body) throw await errorDe(r)

    let final: RespuestaChat | null = null
    for await (const { evento, datos } of leerEventos(r.body)) {
      const e = interpretar(evento, datos)
      if (!e) continue
      alEvento(e)
      if (e.tipo === "respuesta") final = e.respuesta
      if (e.tipo === "error") throw new ErrorApi(409, e.error)
    }
    if (!final) throw new ErrorApi(0, "La conexión se cortó antes de terminar. Intenta de nuevo.")
    return final
  },
}

function interpretar(evento: string, datos: string): EventoTurno | null {
  const d = JSON.parse(datos) as Record<string, unknown>
  switch (evento) {
    case "pensando":
      return { tipo: "pensando", iteracion: Number(d.iteracion) }
    case "paso_inicio":
      return { tipo: "paso_inicio", id: String(d.id), nombre: String(d.nombre) }
    case "paso_fin":
      return { tipo: "paso_fin", llamada: d.llamada as Llamada }
    case "respuesta":
      return { tipo: "respuesta", respuesta: d as unknown as RespuestaChat }
    case "error":
      return { tipo: "error", error: String(d.error) }
    default:
      return null
  }
}

/** Parser mínimo de SSE: bloques separados por línea en blanco con `event:` y `data:`. */
export async function* leerEventos(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<{ evento: string; datos: string }> {
  const lector = cuerpo.getReader()
  const decodificador = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await lector.read()
    if (value) buffer += decodificador.decode(value, { stream: true }).replaceAll("\r\n", "\n")
    let corte = buffer.indexOf("\n\n")
    while (corte >= 0) {
      const bloque = buffer.slice(0, corte)
      buffer = buffer.slice(corte + 2)
      const evento = /^event: ?(.*)$/m.exec(bloque)?.[1] ?? "message"
      const datos = [...bloque.matchAll(/^data: ?(.*)$/gm)].map((m) => m[1]).join("\n")
      if (datos) yield { evento, datos }
      corte = buffer.indexOf("\n\n")
    }
    if (done) return
  }
}
