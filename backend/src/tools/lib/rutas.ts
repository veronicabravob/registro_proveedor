import { existsSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { z } from "zod"
import { ErrorDeHerramienta, type ToolContext } from "../types.ts"

/** Nombre de caso seguro: impide rutas absolutas o `..` (path traversal) desde argumentos del modelo. */
export const CASO_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export const casoArg = z
  .string()
  .regex(CASO_RE, "El caso solo admite minúsculas, números y guiones")
  .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, p. ej. ec-corp-andina")

export interface Rutas {
  raiz: string
  fixtures: string
  casos: string
  repositorio: string
  soportes: string
  glosario: string
  out: string
}

export function rutas(ctx: Pick<ToolContext, "directory">): Rutas {
  const raiz = resolve(ctx.directory)
  const fixtures = join(raiz, "fixtures", "reto-01")
  const repositorio = join(fixtures, "repositorio")
  return {
    raiz,
    fixtures,
    casos: join(fixtures, "casos"),
    repositorio,
    soportes: join(repositorio, "soportes"),
    glosario: join(fixtures, "glosario-campos.json"),
    out: join(raiz, "out"),
  }
}

export function listarCasos(ctx: Pick<ToolContext, "directory">): string[] {
  const { casos } = rutas(ctx)
  if (!existsSync(casos)) return []
  return readdirSync(casos)
    .filter((n) => CASO_RE.test(n) && statSync(join(casos, n)).isDirectory())
    .sort()
}

/** Carpeta de entrada del caso; falla con un mensaje claro si no existe. */
export function dirCaso(ctx: Pick<ToolContext, "directory">, caso: string): string {
  if (!CASO_RE.test(caso)) throw new ErrorDeHerramienta(`Nombre de caso inválido: "${caso}"`)
  const dir = join(rutas(ctx).casos, caso)
  if (!existsSync(dir)) {
    const disponibles = listarCasos(ctx).join(", ") || "ninguno"
    throw new ErrorDeHerramienta(`El caso "${caso}" no existe. Casos disponibles: ${disponibles}`)
  }
  return dir
}

/** Carpeta de salida del caso dentro de out/. */
export function dirSalida(ctx: Pick<ToolContext, "directory">, caso: string): string {
  if (!CASO_RE.test(caso)) throw new ErrorDeHerramienta(`Nombre de caso inválido: "${caso}"`)
  return join(rutas(ctx).out, caso)
}

/** Ruta relativa a la raíz del proyecto, con `/`, para mostrar al usuario sin exponer rutas absolutas. */
export function rutaRelativa(ctx: Pick<ToolContext, "directory">, absoluta: string): string {
  return relative(rutas(ctx).raiz, absoluta).split(sep).join("/")
}
