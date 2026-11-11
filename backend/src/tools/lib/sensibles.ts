import type { ToolContext } from "../types.ts"
import { leerMaestro } from "./datos.ts"
import { formatearValor, valorEnRuta } from "./mapeo.ts"
import { reglas } from "./reglas.ts"

/** Valores reales de los campos marcados como sensibles en reglas.json (para enmascarar trazas y logs). */
export function valoresSensibles(ctx: Pick<ToolContext, "directory">): string[] {
  try {
    const maestro = leerMaestro(ctx)
    return reglas().campos_sensibles.flatMap((clave) => {
      const v = formatearValor(valorEnRuta(maestro, clave))
      return v ? [v] : []
    })
  } catch {
    return []
  }
}
