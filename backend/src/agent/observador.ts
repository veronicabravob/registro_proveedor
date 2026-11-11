import type { Uso } from "../llm/adapter.ts"

/**
 * Puerto de observabilidad del ciclo del agente. El ciclo emite hechos semánticos (turno,
 * herramienta, métricas de negocio) sin conocer OpenTelemetry ni Langfuse; la implementación
 * concreta vive en src/telemetry/. Por defecto no hace nada.
 */
export type Atributo = string | number | boolean

export interface Tramo {
  atributos(a: Readonly<Record<string, Atributo | undefined>>): void
  entrada(valor: unknown): void
  salida(valor: unknown): void
  error(mensaje: string): void
}

export type TipoTramo = "turno" | "herramienta"

export interface ContextoTramo {
  sesionId: string
  nombre: string
}

export type EventoAgente =
  | {
      tipo: "turno"
      resultado: "ok" | "error" | "tope_iteraciones" | "tope_tokens" | "rechazo"
      iteraciones: number
      duracionMs: number
    }
  | { tipo: "llm"; modelo: string; uso: Uso; duracionMs: number; ok: boolean }
  | { tipo: "herramienta"; nombre: string; ok: boolean; duracionMs: number }
  | { tipo: "confirmacion"; estado: "solicitada" | "aprobada" | "rechazada" | "bloqueada" }
  | { tipo: "error"; origen: "llm" | "herramienta" | "interno"; clase: string }
  | { tipo: "campos"; llenos: number; faltantes: number; porConfirmar: number }
  | { tipo: "paquete"; listo: boolean }

export interface Observador {
  envolver<T>(tipo: TipoTramo, ctx: ContextoTramo, fn: (tramo: Tramo) => Promise<T>): Promise<T>
  evento(e: EventoAgente): void
}

const tramoNulo: Tramo = { atributos() {}, entrada() {}, salida() {}, error() {} }

export const observadorNulo: Observador = {
  envolver: (_tipo, _ctx, fn) => fn(tramoNulo),
  evento() {},
}
