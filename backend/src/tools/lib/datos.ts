import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { z } from "zod"
import { ErrorDeHerramienta, type ToolContext } from "../types.ts"
import { dirCaso, rutas } from "./rutas.ts"

// ── Esquemas de los fixtures (contrato de entrada, PRD §7.1–7.2) ─────────────────────────────

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha YYYY-MM-DD")
const Celda = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/, "referencia de celda tipo B3")

export const SolicitudSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: Fecha,
  pais: z.string().length(2),
  cliente: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
})
export type Solicitud = z.infer<typeof SolicitudSchema>
export type Formato = Solicitud["formato"]

export const PlantillaCeldasSchema = z
  .array(z.object({ hoja: z.string().min(1).max(31), celda_etiqueta: Celda, etiqueta: z.string().min(1), celda_valor: Celda }))
  .min(1)
export type CeldaPlantilla = z.infer<typeof PlantillaCeldasSchema>[number]

export const PlantillaCamposSchema = z.array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() })).min(1)

export const SoportesExigidosSchema = z.array(z.string().min(1))

export const GlosarioSchema = z.record(z.string(), z.string())

export const MaestroSchema = z.record(z.string(), z.unknown())
export type Maestro = z.infer<typeof MaestroSchema>

export const IndiceSoportesSchema = z.array(
  z.object({
    tipo: z.string(),
    // Solo un nombre de archivo: impide que el índice apunte fuera de repositorio/soportes/.
    archivo: z.string().refine((a) => basename(a) === a, "archivo debe ser un nombre sin rutas"),
    vigencia_hasta: Fecha.nullable(),
    pais_emisor: z.string(),
    descripcion: z.string().optional(),
  }),
)
export type SoporteIndice = z.infer<typeof IndiceSoportesSchema>[number]

// ── Lectura validada ──────────────────────────────────────────────────────────────────────────

/** Lee y valida un JSON; traduce cualquier fallo a un mensaje claro (HU-5), sin trazas crudas. */
export function leerJson<T>(ruta: string, esquema: z.ZodType<T>, descripcion: string): T {
  if (!existsSync(ruta)) throw new ErrorDeHerramienta(`No se encontró ${descripcion} (${basename(ruta)})`)
  let crudo: unknown
  try {
    crudo = JSON.parse(readFileSync(ruta, "utf8"))
  } catch {
    throw new ErrorDeHerramienta(`${descripcion} (${basename(ruta)}) está corrupto: no es un JSON válido`)
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) {
    const detalle = r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ")
    throw new ErrorDeHerramienta(`${descripcion} (${basename(ruta)}) no tiene el formato esperado: ${detalle}`)
  }
  return r.data
}

export interface CampoSolicitado {
  etiqueta: string
  /** `null` cuando la plantilla (Excel) no indica obligatoriedad. */
  obligatorio: boolean | null
}

export type Plantilla =
  | { tipo: "celdas"; archivo: string; celdas: CeldaPlantilla[]; campos: CampoSolicitado[] }
  | { tipo: "campos"; archivo: string; campos: CampoSolicitado[] }

export interface Caso {
  caso: string
  solicitud: Solicitud
  soportesExigidos: string[]
}

export function leerCaso(ctx: Pick<ToolContext, "directory">, caso: string): Caso {
  const dir = dirCaso(ctx, caso)
  const solicitud = leerJson(join(dir, "solicitud.json"), SolicitudSchema, "La solicitud del cliente")
  const soportesExigidos = leerJson(join(dir, "soportes-exigidos.json"), SoportesExigidosSchema, "La lista de soportes exigidos")
  return { caso, solicitud, soportesExigidos }
}

/** Plantilla según el formato: Excel → celdas; PDF y portal → campos ordenados. */
export function leerPlantilla(ctx: Pick<ToolContext, "directory">, caso: string, formato: Formato): Plantilla {
  const dir = dirCaso(ctx, caso)
  if (formato === "xlsx") {
    const celdas = leerJson(join(dir, "plantilla-celdas.json"), PlantillaCeldasSchema, "La plantilla Excel")
    return {
      tipo: "celdas",
      archivo: "plantilla-celdas.json",
      celdas,
      campos: celdas.map((c) => ({ etiqueta: c.etiqueta, obligatorio: null })),
    }
  }
  const campos = leerJson(join(dir, "plantilla-campos.json"), PlantillaCamposSchema, "La plantilla de campos")
  return { tipo: "campos", archivo: "plantilla-campos.json", campos }
}

export function leerMaestro(ctx: Pick<ToolContext, "directory">): Maestro {
  return leerJson(join(rutas(ctx).repositorio, "maestro.json"), MaestroSchema, "El repositorio maestro")
}

export function leerGlosario(ctx: Pick<ToolContext, "directory">): Record<string, string> {
  return leerJson(rutas(ctx).glosario, GlosarioSchema, "El glosario de campos")
}

export function leerIndiceSoportes(ctx: Pick<ToolContext, "directory">): SoporteIndice[] {
  return leerJson(join(rutas(ctx).soportes, "index.json"), IndiceSoportesSchema, "El índice de soportes")
}
