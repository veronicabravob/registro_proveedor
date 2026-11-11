import type { z } from "zod"

/** Contexto que el backend inyecta a cada herramienta (PRD §6.2). */
export interface ToolContext {
  /** Raíz del proyecto; todas las rutas se resuelven desde aquí. */
  directory: string
  sessionId: string
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Contrato de herramienta: description + args zod + execute que nunca lanza. */
export interface Tool<A extends z.ZodRawShape = z.ZodRawShape> {
  description: string
  args: A
  execute(args: z.infer<z.ZodObject<A>>, ctx: ToolContext): Promise<string>
}

export const ok = <T>(data: T): string => JSON.stringify({ ok: true, data } satisfies ToolResult<T>)
export const fail = (error: string): string => JSON.stringify({ ok: false, error } satisfies ToolResult<never>)
