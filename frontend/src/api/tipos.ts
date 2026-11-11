// Contrato de la API del backend (backend/src/http/app.ts).

export interface Llamada {
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

export interface Uso {
  entrada: number
  salida: number
  cacheLectura: number
  cacheEscritura: number
  sessionLimit: number
}

export interface RespuestaChat {
  sessionId: string
  reply: string
  toolCalls: Llamada[]
  needsConfirmation: boolean
  pendingAction: AccionPendiente | null
  error: { tipo: string; mensaje: string } | null
  iterations: number
  usage: Uso
}

export type EntradaHistorial =
  | { rol: "usuario"; texto: string; ts: string }
  | { rol: "asistente"; texto: string; ts: string; llamadas: Llamada[]; needsConfirmation: boolean; error?: string }

export interface Sesion {
  sessionId: string
  messages: EntradaHistorial[]
  pendingAction: AccionPendiente | null
  usage: Uso
}

export interface Caso {
  caso: string
  cliente: string | null
  pais: string | null
  formato: "xlsx" | "pdf" | "portal" | null
}

export interface Salud {
  ok: boolean
  provider: string
  model: string
  llmConfigured: boolean
  accessKeyRequired: boolean
}

/** Eventos del streaming de un turno (POST /api/chat/stream). */
export type EventoTurno =
  | { tipo: "pensando"; iteracion: number }
  | { tipo: "paso_inicio"; id: string; nombre: string }
  | { tipo: "paso_fin"; llamada: Llamada }
  | { tipo: "respuesta"; respuesta: RespuestaChat }
  | { tipo: "error"; error: string }
