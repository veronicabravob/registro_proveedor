/**
 * Interfaz propia del proveedor de lenguaje (PRD §6.1): `enviar(mensajes, herramientas) → respuesta`.
 * El ciclo del agente solo conoce estos tipos; cambiar de proveedor no toca el ciclo.
 */
import type { EspecificacionHerramienta } from "../tools/index.ts"

export type Parte =
  | { tipo: "texto"; texto: string }
  | { tipo: "llamada"; id: string; nombre: string; args: unknown }
  | { tipo: "resultado"; llamadaId: string; contenido: string; esError: boolean }

export interface Mensaje {
  rol: "usuario" | "asistente"
  partes: Parte[]
  /**
   * Contenido nativo del proveedor que produjo este mensaje (p. ej. bloques de razonamiento),
   * para reenviarlo intacto al mismo proveedor. Opaco para el ciclo del agente.
   */
  nativo?: { proveedor: string; contenido: unknown }
}

export type MotivoFin = "fin_turno" | "herramientas" | "max_tokens" | "rechazo" | "otro"

export interface Uso {
  entrada: number
  salida: number
  cacheLectura: number
  cacheEscritura: number
}

export interface Respuesta {
  mensaje: Mensaje
  motivo: MotivoFin
  uso: Uso
  modelo: string
}

export interface PeticionLlm {
  sistema: string
  mensajes: readonly Mensaje[]
  herramientas: readonly EspecificacionHerramienta[]
  /** Identificador de la conversación para correlacionar trazas. */
  sesionId: string
  senal?: AbortSignal
}

export interface AdaptadorLlm {
  readonly proveedor: string
  readonly modelo: string
  enviar(peticion: PeticionLlm): Promise<Respuesta>
}

export type TipoErrorLlm = "timeout" | "limite" | "autenticacion" | "solicitud" | "proveedor" | "red"

/** Error normalizado del proveedor: el mensaje es apto para el chat (CA5), sin trazas ni claves. */
export class ErrorLlm extends Error {
  override readonly name = "ErrorLlm"
  constructor(
    readonly tipo: TipoErrorLlm,
    mensaje: string,
    readonly reintentable: boolean,
  ) {
    super(mensaje)
  }
}

export const usoVacio = (): Uso => ({ entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 })

export function textoDe(mensaje: Mensaje): string {
  return mensaje.partes
    .flatMap((p) => (p.tipo === "texto" ? [p.texto] : []))
    .join("\n")
    .trim()
}
