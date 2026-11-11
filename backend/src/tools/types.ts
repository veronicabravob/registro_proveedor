import { z } from "zod"

/** Contexto que el host (servidor, demo o plataforma de agentes) inyecta a cada herramienta (PRD §6.2). */
export interface ToolContext {
  /** Raíz del proyecto; todas las rutas se resuelven desde aquí, nunca absolutas. */
  directory: string
  sessionId: string
  /**
   * Acciones aprobadas por un humano en el turno inmediatamente anterior, con la forma `accion:caso`.
   * Solo lo llena el host (el ciclo del agente), nunca el modelo. Si el host no lo provee,
   * la herramienta exige únicamente `confirmado: true` y delega el control al host.
   */
  confirmaciones?: ReadonlySet<string>
  /** Fecha de ejecución `YYYY-MM-DD` para evaluar vigencias. Por defecto, la fecha local de hoy. */
  fechaEjecucion?: string
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Contrato de herramienta (PRD §6.2): description + args zod + execute que devuelve JSON y nunca lanza. */
export interface Tool<A extends z.ZodRawShape = z.ZodRawShape> {
  description: string
  args: A
  execute(args: z.infer<z.ZodObject<A>>, ctx: ToolContext): Promise<string>
}

/** Error esperado de negocio: su mensaje es apto para mostrarse al usuario y al modelo. */
export class ErrorDeHerramienta extends Error {
  override readonly name = "ErrorDeHerramienta"
}

/** Interpreta la salida serializada de una herramienta. */
export function leerResultado(salida: string): ToolResult<Record<string, unknown>> {
  try {
    const valor: unknown = JSON.parse(salida)
    const esquema = z.union([
      z.object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()) }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ])
    const r = esquema.safeParse(valor)
    return r.success ? r.data : { ok: false, error: "Salida de herramienta con formato inválido" }
  } catch {
    return { ok: false, error: "Salida de herramienta no es JSON" }
  }
}
