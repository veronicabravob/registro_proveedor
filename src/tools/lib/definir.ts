import { z } from "zod"
import { ErrorDeHerramienta, type Tool, type ToolContext } from "../types.ts"
import { registrarEnCaso } from "./bitacora.ts"

export interface Ejecucion<T> {
  data: T
  /** Una línea legible para el chat, la bitácora y las trazas. Nunca incluye datos sensibles. */
  resumen: string
}

interface Definicion<A extends z.ZodRawShape, T> {
  description: string
  args: A
  run(args: z.infer<z.ZodObject<A>>, ctx: ToolContext): Promise<Ejecucion<T>>
}

function describirErrores(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ")
}

/**
 * Envuelve la lógica de una herramienta con el contrato del PRD §6.2:
 * valida argumentos con zod, nunca lanza, devuelve `{ ok, data }` / `{ ok: false, error }`
 * serializado y registra la ejecución en la bitácora del caso (RN5).
 */
export function definirHerramienta<A extends z.ZodRawShape, T extends object>(nombre: string, def: Definicion<A, T>): Tool<A> {
  const esquema = z.object(def.args).strict()
  return {
    description: def.description,
    args: def.args,
    async execute(args, ctx) {
      const parsed = esquema.safeParse(args)
      if (!parsed.success) return JSON.stringify({ ok: false, error: `Argumentos inválidos: ${describirErrores(parsed.error)}` })

      const caso = typeof (parsed.data as { caso?: unknown }).caso === "string" ? (parsed.data as { caso: string }).caso : undefined
      try {
        const { data, resumen } = await def.run(parsed.data, ctx)
        if (caso) registrarEnCaso(ctx, caso, { herramienta: nombre, ok: true, resumen })
        return JSON.stringify({ ok: true, data: { ...data, resumen } })
      } catch (e) {
        const error =
          e instanceof ErrorDeHerramienta ? e.message : `Error interno en ${nombre}. El detalle quedó en el log del servidor.`
        if (!(e instanceof ErrorDeHerramienta)) process.stderr.write(`[${nombre}] ${e instanceof Error ? e.message : String(e)}\n`)
        if (caso) registrarEnCaso(ctx, caso, { herramienta: nombre, ok: false, resumen: error })
        return JSON.stringify({ ok: false, error })
      }
    },
  }
}
