import { randomUUID } from "node:crypto"
import { type Mensaje, type Uso, usoVacio } from "../llm/adapter.ts"

export interface LlamadaVisible {
  id: string
  nombre: string
  args: unknown
  ok: boolean
  resumen: string
  duracionMs: number
}

export interface AccionPendiente {
  accion: string
  caso: string
  detalle: string
}

export type EntradaTranscripcion =
  | { rol: "usuario"; texto: string; ts: string }
  | {
      rol: "asistente"
      texto: string
      ts: string
      llamadas: LlamadaVisible[]
      needsConfirmation: boolean
      error?: string
    }

export interface Sesion {
  id: string
  creada: number
  actualizada: number
  /** Historial que se envía al modelo (incluye contenido nativo del proveedor). */
  mensajes: Mensaje[]
  /** Historial visible para la API y el front. */
  transcripcion: EntradaTranscripcion[]
  uso: Uso
  pendiente: AccionPendiente | null
  ocupada: boolean
}

export const SESION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/** Sesiones en memoria con tope y expiración (sin base de datos, PRD §3.2). */
export class AlmacenSesiones {
  private readonly sesiones = new Map<string, Sesion>()

  constructor(
    private readonly maximo: number,
    private readonly ttlMs: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  obtener(id: string): Sesion | undefined {
    this.purgar()
    const s = this.sesiones.get(id)
    if (!s) return undefined
    // LRU: reinsertar mueve la sesión al final del orden de inserción.
    this.sesiones.delete(id)
    this.sesiones.set(id, s)
    return s
  }

  crear(id: string = randomUUID()): Sesion {
    this.purgar()
    while (this.sesiones.size >= this.maximo) {
      const masAntigua = this.sesiones.keys().next().value
      if (masAntigua === undefined) break
      this.sesiones.delete(masAntigua)
    }
    const t = this.ahora()
    const s: Sesion = {
      id,
      creada: t,
      actualizada: t,
      mensajes: [],
      transcripcion: [],
      uso: usoVacio(),
      pendiente: null,
      ocupada: false,
    }
    this.sesiones.set(id, s)
    return s
  }

  get tamano(): number {
    return this.sesiones.size
  }

  private purgar(): void {
    const limite = this.ahora() - this.ttlMs
    for (const [id, s] of this.sesiones) if (s.actualizada < limite && !s.ocupada) this.sesiones.delete(id)
  }
}
