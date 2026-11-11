import { createHash } from "node:crypto"
import { z } from "zod"
import type { CampoSolicitado, Maestro } from "./datos.ts"
import type { Reglas } from "./reglas.ts"
import { normalizar, similitud, tokens } from "./texto.ts"

export interface CampoLleno {
  etiqueta: string
  clave: string
  /** Ruta trazable del dato en el maestro, p. ej. `maestro.json#banco.numero_cuenta`. */
  ruta: string
  valor: string
  confianza: number
  sensible: boolean
}

export interface CampoFaltante {
  etiqueta: string
  obligatorio: boolean | null
  motivo: string
}

export interface CampoPorConfirmar {
  etiqueta: string
  clave: string
  ruta: string
  valor_propuesto: string
  confianza: number
  motivo: string
  sensible: boolean
  equivalente_pais?: string
}

export interface Mapeo {
  mapeo_id: string
  caso: string
  pais: string
  llenos: CampoLleno[]
  faltantes: CampoFaltante[]
  requiere_confirmacion: CampoPorConfirmar[]
}

/** Esquema del mapeo persistido en out/<caso>/mapeo.json (se valida al releerlo). */
export const MapeoArchivoSchema = z.object({
  campos: z.array(z.object({ etiqueta: z.string(), obligatorio: z.boolean().nullable() })),
  mapeo: z.object({
    mapeo_id: z.string(),
    caso: z.string(),
    pais: z.string(),
    llenos: z.array(
      z.object({
        etiqueta: z.string(),
        clave: z.string(),
        ruta: z.string(),
        valor: z.string(),
        confianza: z.number(),
        sensible: z.boolean(),
      }),
    ),
    faltantes: z.array(z.object({ etiqueta: z.string(), obligatorio: z.boolean().nullable(), motivo: z.string() })),
    requiere_confirmacion: z.array(
      z.object({
        etiqueta: z.string(),
        clave: z.string(),
        ruta: z.string(),
        valor_propuesto: z.string(),
        confianza: z.number(),
        motivo: z.string(),
        sensible: z.boolean(),
        equivalente_pais: z.string().optional(),
      }),
    ),
  }),
})

interface Candidato {
  clave: string
  confianza: number
  origen: "glosario" | "maestro" | "similitud"
  etiquetaGlosario?: string
}

/** Busca la clave del maestro para una etiqueta: glosario exacto → clave literal → similitud. */
export function resolverClave(
  etiqueta: string,
  glosario: Readonly<Record<string, string>>,
  maestro: Maestro,
  r: Reglas,
): Candidato | undefined {
  const norm = normalizar(etiqueta)
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === norm) return { clave, confianza: 1, origen: "glosario" }
  }
  const comoClave = norm.replaceAll(" ", "_")
  if (comoClave in maestro) return { clave: comoClave, confianza: 0.9, origen: "maestro" }

  const vacias = new Set(r.palabras_vacias)
  const objetivo = tokens(etiqueta, vacias)
  let mejor: Candidato | undefined
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    const s = similitud(objetivo, tokens(sinonimo, vacias))
    if (!mejor || s > mejor.confianza) {
      mejor = { clave, confianza: Math.round(s * 100) / 100, origen: "similitud", etiquetaGlosario: sinonimo }
    }
  }
  return mejor && mejor.confianza >= r.umbral_sugerencia ? mejor : undefined
}

/** Lee `a.b.c` del maestro. */
export function valorEnRuta(maestro: Maestro, clave: string): unknown {
  let actual: unknown = maestro
  for (const parte of clave.split(".")) {
    if (typeof actual !== "object" || actual === null || !(parte in actual)) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

/** Solo valores escalares se escriben en un formulario; nunca se "arma" un valor compuesto. */
export function formatearValor(valor: unknown): string | undefined {
  if (typeof valor === "string") return valor.trim() === "" ? undefined : valor
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor)
  if (typeof valor === "boolean") return valor ? "Sí" : "No"
  if (Array.isArray(valor) && valor.every((v) => typeof v === "string") && valor.length > 0) return valor.join(", ")
  return undefined
}

function esAmbigua(etiqueta: string, r: Reglas): boolean {
  const norm = normalizar(etiqueta)
  return r.etiquetas_ambiguas.some((e) => normalizar(e) === norm)
}

export function equivalenteTributario(pais: string, r: Reglas): string {
  return r.identificador_tributario_por_pais[pais] ?? "identificador tributario"
}

function mapearUno(
  campo: CampoSolicitado,
  pais: string,
  maestro: Maestro,
  glosario: Readonly<Record<string, string>>,
  r: Reglas,
): { lleno: CampoLleno } | { faltante: CampoFaltante } | { porConfirmar: CampoPorConfirmar } {
  const { etiqueta, obligatorio } = campo
  const candidato = resolverClave(etiqueta, glosario, maestro, r)
  if (!candidato) return { faltante: { etiqueta, obligatorio, motivo: "Sin equivalente en el repositorio maestro" } }

  const valor = formatearValor(valorEnRuta(maestro, candidato.clave))
  if (valor === undefined) {
    return { faltante: { etiqueta, obligatorio, motivo: `La clave "${candidato.clave}" no tiene un valor en el maestro` } }
  }

  const base = {
    etiqueta,
    clave: candidato.clave,
    ruta: `maestro.json#${candidato.clave}`,
    confianza: candidato.confianza,
    sensible: r.campos_sensibles.includes(candidato.clave),
  }

  // RN1: identificador tributario por país.
  if (candidato.clave === r.clave_identificador_tributario) {
    const equivalente = equivalenteTributario(pais, r)
    if (pais !== r.pais_maestro) {
      return {
        porConfirmar: {
          ...base,
          valor_propuesto: valor,
          equivalente_pais: equivalente,
          motivo: `identificador extranjero: el cliente (${pais}) usa ${equivalente}; Periferia solo tiene NIT colombiano`,
        },
      }
    }
    if (esAmbigua(etiqueta, r)) {
      return {
        porConfirmar: {
          ...base,
          valor_propuesto: valor,
          equivalente_pais: equivalente,
          motivo: `etiqueta ambigua: en ${pais} el equivalente es ${equivalente}`,
        },
      }
    }
  }

  if (candidato.confianza < r.umbral_confianza) {
    return {
      porConfirmar: {
        ...base,
        valor_propuesto: valor,
        motivo: `mapeo con confianza ${candidato.confianza} < ${r.umbral_confianza} (parecido a "${candidato.etiquetaGlosario ?? candidato.clave}")`,
      },
    }
  }

  return { lleno: { ...base, valor } }
}

/**
 * Mapeo determinista campo → maestro. El valor siempre sale del maestro: un campo sin fuente
 * queda `faltante` y jamás se inventa (HU-2, CA2).
 */
export function mapearCampos(
  caso: string,
  campos: readonly CampoSolicitado[],
  pais: string,
  maestro: Maestro,
  glosario: Readonly<Record<string, string>>,
  r: Reglas,
): Mapeo {
  const llenos: CampoLleno[] = []
  const faltantes: CampoFaltante[] = []
  const requiere_confirmacion: CampoPorConfirmar[] = []
  for (const campo of campos) {
    const res = mapearUno(campo, pais, maestro, glosario, r)
    if ("lleno" in res) llenos.push(res.lleno)
    else if ("faltante" in res) faltantes.push(res.faltante)
    else requiere_confirmacion.push(res.porConfirmar)
  }
  const cuerpo = { caso, pais, llenos, faltantes, requiere_confirmacion }
  const mapeo_id = `${caso}@${createHash("sha256").update(JSON.stringify(cuerpo)).digest("hex").slice(0, 10)}`
  return { mapeo_id, ...cuerpo }
}

/** Valor a escribir en el formulario para una etiqueta (llenos y propuestos por confirmar). */
export function valorParaFormulario(
  mapeo: Mapeo,
  etiqueta: string,
): { valor: string; estado: "lleno" | "requiere_confirmacion"; nota?: string } | { valor: ""; estado: "faltante"; nota: string } {
  const lleno = mapeo.llenos.find((c) => c.etiqueta === etiqueta)
  if (lleno) return { valor: lleno.valor, estado: "lleno" }
  const pc = mapeo.requiere_confirmacion.find((c) => c.etiqueta === etiqueta)
  if (pc) return { valor: pc.valor_propuesto, estado: "requiere_confirmacion", nota: pc.motivo }
  const f = mapeo.faltantes.find((c) => c.etiqueta === etiqueta)
  return { valor: "", estado: "faltante", nota: f?.motivo ?? "Campo no mapeado" }
}

/** Deja visibles solo los 4 últimos caracteres de los campos sensibles (cuenta, SWIFT, cédula). */
export function ocultarSensibles(m: Mapeo): Mapeo {
  const ocultar = (v: string): string => `••••${v.slice(-4)}`
  return {
    ...m,
    llenos: m.llenos.map((c) => (c.sensible ? { ...c, valor: ocultar(c.valor) } : c)),
    requiere_confirmacion: m.requiere_confirmacion.map((c) =>
      c.sensible ? { ...c, valor_propuesto: ocultar(c.valor_propuesto) } : c,
    ),
  }
}
