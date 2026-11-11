import { z } from "zod"
import * as proveedor from "./proveedor.ts"
import type { Tool } from "./types.ts"

/** Herramientas disponibles con el nombre que ve el modelo: `<archivo>_<export>` (PRD §6.2). */
export const herramientas: Readonly<Record<string, Tool>> = Object.fromEntries(
  Object.entries(proveedor).map(([nombre, tool]) => [`proveedor_${nombre}`, tool as unknown as Tool]),
)

/** Herramientas que ejecutan una acción externa: el ciclo exige aprobación humana previa (RN4, CA3). */
export const REQUIEREN_CONFIRMACION: Readonly<Record<string, string>> = {
  proveedor_simular_envio: "simular_envio",
}

export const HERRAMIENTA_SOLICITAR_CONFIRMACION = "proveedor_solicitar_confirmacion"

export interface EspecificacionHerramienta {
  name: string
  description: string
  /** JSON Schema derivado de los esquemas zod (fuente única de verdad de los argumentos). */
  parameters: Record<string, unknown>
}

export function especificaciones(registro: Readonly<Record<string, Tool>> = herramientas): EspecificacionHerramienta[] {
  return Object.entries(registro)
    .sort(([a], [b]) => a.localeCompare(b)) // orden estable: no invalida la caché de prompt
    .map(([name, tool]) => {
      const { $schema: _omitido, ...parameters } = z.toJSONSchema(z.object(tool.args).strict()) as Record<string, unknown>
      return { name, description: tool.description, parameters }
    })
}
