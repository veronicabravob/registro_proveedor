import type { Llamada, RespuestaChat } from "../api/tipos.ts"

/** Conversaciones recientes de esta analista (en su navegador). El historial completo vive en el servidor. */
export interface ConversacionGuardada {
  id: string
  titulo: string
  caso: string | null
  estado: string
  actualizada: string
}

const CLAVE = "rp.conversaciones"
const MAXIMO = 20

export function leerConversaciones(): ConversacionGuardada[] {
  try {
    const crudo: unknown = JSON.parse(localStorage.getItem(CLAVE) ?? "[]")
    return Array.isArray(crudo) ? (crudo as ConversacionGuardada[]) : []
  } catch {
    return []
  }
}

export function guardarConversaciones(lista: readonly ConversacionGuardada[]): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista.slice(0, MAXIMO)))
  } catch {
    /* almacenamiento no disponible */
  }
}

export function actualizarConversacion(lista: readonly ConversacionGuardada[], c: ConversacionGuardada): ConversacionGuardada[] {
  return [c, ...lista.filter((x) => x.id !== c.id)].slice(0, MAXIMO)
}

/** Estado en palabras de la analista, a partir de lo que pasó en el último turno. */
export function estadoDe(r: Pick<RespuestaChat, "needsConfirmation" | "error">, llamadas: readonly Llamada[]): string {
  if (r.needsConfirmation) return "espera tu respuesta"
  if (llamadas.some((l) => l.nombre === "proveedor_simular_envio" && l.ok)) return "envío simulado hecho"
  const paquete = llamadas.filter((l) => l.nombre === "proveedor_armar_paquete" && l.ok).at(-1)
  if (paquete) return /^Listo/.test(paquete.resumen) ? "paquete listo para firma" : "paquete con pendientes"
  if (r.error) return "con un error"
  return "consulta"
}

export function cuando(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso)
  const hora = fecha.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })
  const dias = Math.floor((new Date(ahora.toDateString()).getTime() - new Date(fecha.toDateString()).getTime()) / 86_400_000)
  if (dias <= 0) return `Hoy, ${hora}`
  if (dias === 1) return "Ayer"
  return fecha.toLocaleDateString("es-CO", { weekday: "long" }).replace(/^\w/, (l) => l.toUpperCase())
}
