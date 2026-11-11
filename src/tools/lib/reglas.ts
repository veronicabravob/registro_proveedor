import { readFileSync } from "node:fs"
import { z } from "zod"

/**
 * Reglas de negocio como datos (conocimiento), no como código: viven en src/knowledge/reglas.json.
 * Se resuelven relativas a este módulo para que las herramientas funcionen igual desde el servidor,
 * desde demo.ts o importadas desde modulo/.
 */
const ReglasSchema = z.object({
  version: z.string(),
  pais_maestro: z.string().length(2),
  clave_identificador_tributario: z.string(),
  identificador_tributario_por_pais: z.record(z.string(), z.string()),
  etiquetas_ambiguas: z.array(z.string()),
  umbral_confianza: z.number().min(0).max(1),
  umbral_sugerencia: z.number().min(0).max(1),
  palabras_vacias: z.array(z.string()),
  campos_bancarios: z.array(z.string()),
  campos_sensibles: z.array(z.string()),
  soportes: z.record(z.string(), z.string()),
})
export type Reglas = z.infer<typeof ReglasSchema>

const URL_REGLAS = new URL("../../knowledge/reglas.json", import.meta.url)

let cache: Reglas | undefined

export function reglas(): Reglas {
  cache ??= ReglasSchema.parse(JSON.parse(readFileSync(URL_REGLAS, "utf8")))
  return cache
}

export function nombreSoporte(tipo: string): string {
  return reglas().soportes[tipo] ?? tipo.replaceAll("_", " ")
}
