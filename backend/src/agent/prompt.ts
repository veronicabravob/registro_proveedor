import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * System prompt = comportamiento (agent/prompt.md) + conocimiento del proceso
 * (src/knowledge/registro-proveedor.md). Se arma una sola vez al arrancar y no contiene datos
 * variables (fecha, ids), para que el prefijo sea estable y aproveche la caché de prompt.
 */
export function cargarSistema(dirBackend: string): string {
  const comportamiento = readFileSync(join(dirBackend, "agent", "prompt.md"), "utf8").trim()
  const conocimiento = readFileSync(join(dirBackend, "src", "knowledge", "registro-proveedor.md"), "utf8").trim()
  return `${comportamiento}\n\n---\n\n${conocimiento}\n`
}
