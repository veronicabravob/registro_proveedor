import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { ToolContext } from "../types.ts"
import { dirSalida, rutas } from "./rutas.ts"

export interface EntradaBitacora {
  herramienta: string
  ok: boolean
  resumen: string
}

/**
 * RN5: cada ejecución deja `{ ts, herramienta, ok, resumen }` en out/<caso>/log.jsonl.
 * Solo registra casos existentes, para no crear carpetas a partir de nombres arbitrarios.
 * Un fallo de escritura del log nunca rompe la herramienta.
 */
export function registrarEnCaso(ctx: ToolContext, caso: string, entrada: EntradaBitacora): void {
  try {
    if (!existsSync(join(rutas(ctx).casos, caso))) return
    const dir = dirSalida(ctx, caso)
    mkdirSync(dir, { recursive: true })
    const linea = { ts: new Date().toISOString(), sessionId: ctx.sessionId, ...entrada }
    appendFileSync(join(dir, "log.jsonl"), `${JSON.stringify(linea)}\n`, "utf8")
  } catch {
    // La bitácora es best-effort.
  }
}
