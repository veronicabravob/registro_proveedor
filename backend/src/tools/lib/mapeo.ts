import { createHash } from "node:crypto"
import { z } from "zod"
import type { CampoSolicitado, Maestro } from "./datos.ts"
import type { Reglas } from "./reglas.ts"
import { agruparMiles, normalizar, similitud, tiposDeDato, tokens } from "./texto.ts"

type ReglasMapeo = Reglas

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

/**
 * Un sinónimo aproximado es incompatible si la etiqueta pide un tipo de dato (teléfono, correo…)
 * y el sinónimo o su clave en el maestro son de otro tipo: "Teléfono del representante legal"
 * nunca puede resolverse a `representante_legal.nombre`.
 */
function tiposCompatibles(
  tiposEtiqueta: ReadonlySet<string>,
  sinonimo: string,
  clave: string,
  r: Pick<ReglasMapeo, "tipos_de_dato">,
): boolean {
  if (tiposEtiqueta.size === 0) return true
  const ultima = clave.split(".").at(-1) ?? clave
  const tiposCandidato = new Set([
    ...tiposDeDato(sinonimo, r.tipos_de_dato),
    ...tiposDeDato(ultima.replaceAll("_", " "), r.tipos_de_dato),
  ])
  if (tiposCandidato.size === 0) return true
  return [...tiposEtiqueta].some((t) => tiposCandidato.has(t))
}

/** Busca la clave del maestro para una etiqueta: glosario exacto → clave literal → similitud compatible. */
export function resolverClave(
  etiqueta: string,
  glosario: Readonly<Record<string, string>>,
  maestro: Maestro,
  r: ReglasMapeo,
): Candidato | undefined {
  const norm = normalizar(etiqueta)
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === norm) return { clave, confianza: 1, origen: "glosario" }
  }
  const comoClave = norm.replaceAll(" ", "_")
  if (comoClave in maestro) return { clave: comoClave, confianza: 0.9, origen: "maestro" }

  const vacias = new Set(r.palabras_vacias)
  const objetivo = tokens(etiqueta, vacias)
  const tiposEtiqueta = tiposDeDato(etiqueta, r.tipos_de_dato)
  // Candidatos: sinónimos del glosario y, además, las rutas del maestro leídas como texto
  // ("contacto_financiero.telefono" → "contacto financiero telefono").
  const candidatos: [string, string][] = [
    ...Object.entries(glosario),
    ...rutasHoja(maestro).map((clave): [string, string] => [clave.replace(/[._]/g, " "), clave]),
  ]
  let mejor: Candidato | undefined
  for (const [sinonimo, clave] of candidatos) {
    if (!tiposCompatibles(tiposEtiqueta, sinonimo, clave, r)) continue
    const s = similitud(objetivo, tokens(sinonimo, vacias))
    if (!mejor || s > mejor.confianza) {
      mejor = { clave, confianza: Math.round(s * 100) / 100, origen: "similitud", etiquetaGlosario: sinonimo }
    }
  }
  return mejor && mejor.confianza >= r.umbral_sugerencia ? mejor : undefined
}

/** Rutas `a.b.c` de los valores escalares del maestro. */
function rutasHoja(valor: unknown, prefijo = ""): string[] {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return prefijo ? [prefijo] : []
  return Object.entries(valor).flatMap(([k, v]) => rutasHoja(v, prefijo ? `${prefijo}.${k}` : k))
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

type Resultado = { lleno: CampoLleno } | { faltante: CampoFaltante } | { porConfirmar: CampoPorConfirmar }
type Base = Omit<CampoLleno, "valor">

/**
 * Valor escalar del maestro. Si la clave es monetaria (reglas.json#campos_monetarios) se escribe
 * con su moneda ("COP 98.000.000.000"); sin moneda en el maestro no se adivina: se pide confirmar.
 */
function valorDelMaestro(maestro: Maestro, clave: string, r: ReglasMapeo): { valor: string; motivo?: string } | undefined {
  const crudo = valorEnRuta(maestro, clave)
  const valor = formatearValor(crudo)
  const claveMoneda = r.campos_monetarios[clave]
  if (valor === undefined || claveMoneda === undefined) return valor === undefined ? undefined : { valor }
  const moneda = formatearValor(valorEnRuta(maestro, claveMoneda))
  if (moneda === undefined) {
    return { valor, motivo: `valor monetario sin moneda en el maestro (${claveMoneda}): confirmar la moneda` }
  }
  return { valor: `${moneda} ${typeof crudo === "number" ? agruparMiles(crudo) : valor}` }
}

/** RN1: identificador tributario por país (extranjero o etiqueta ambigua → confirmar). */
function reglaTributaria(base: Base, valor: string, pais: string, r: Reglas): CampoPorConfirmar | undefined {
  if (base.clave !== r.clave_identificador_tributario) return undefined
  const equivalente = equivalenteTributario(pais, r)
  const propuesta = { ...base, valor_propuesto: valor, equivalente_pais: equivalente }
  if (pais !== r.pais_maestro) {
    return {
      ...propuesta,
      motivo: `identificador extranjero: el cliente (${pais}) usa ${equivalente}; Periferia solo tiene NIT colombiano`,
    }
  }
  if (esAmbigua(base.etiqueta, r)) {
    return { ...propuesta, motivo: `etiqueta ambigua: en ${pais} el equivalente es ${equivalente}` }
  }
  return undefined
}

/** Una coincidencia aproximada nunca queda `lleno`: como máximo se propone para confirmar. */
function motivoAproximado(candidato: Candidato, r: Reglas): string {
  const bajo = candidato.confianza < r.umbral_confianza ? ` < ${r.umbral_confianza}` : ""
  return `mapeo con confianza ${candidato.confianza}${bajo}: coincidencia aproximada con "${candidato.etiquetaGlosario ?? candidato.clave}", verificar que corresponda`
}

function mapearUno(
  campo: CampoSolicitado,
  pais: string,
  maestro: Maestro,
  glosario: Readonly<Record<string, string>>,
  r: ReglasMapeo,
): Resultado {
  const { etiqueta, obligatorio } = campo
  const candidato = resolverClave(etiqueta, glosario, maestro, r)
  if (!candidato) return { faltante: { etiqueta, obligatorio, motivo: "Sin equivalente en el repositorio maestro" } }

  const dato = valorDelMaestro(maestro, candidato.clave, r)
  if (dato === undefined) {
    return { faltante: { etiqueta, obligatorio, motivo: `La clave "${candidato.clave}" no tiene un valor en el maestro` } }
  }

  const base: Base = {
    etiqueta,
    clave: candidato.clave,
    ruta: `maestro.json#${candidato.clave}`,
    confianza: candidato.confianza,
    sensible: r.campos_sensibles.includes(candidato.clave),
  }
  const tributaria = reglaTributaria(base, dato.valor, pais, r)
  if (tributaria) return { porConfirmar: tributaria }
  if (candidato.origen === "similitud") {
    return { porConfirmar: { ...base, valor_propuesto: dato.valor, motivo: motivoAproximado(candidato, r) } }
  }
  if (dato.motivo) return { porConfirmar: { ...base, valor_propuesto: dato.valor, motivo: dato.motivo } }
  return { lleno: { ...base, valor: dato.valor } }
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
  r: ReglasMapeo,
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

/** Etiqueta exacta y, si no está, la que coincide al normalizar (sin tildes ni mayúsculas). */
function buscarPorEtiqueta<T extends { etiqueta: string }>(lista: readonly T[], etiqueta: string): T | undefined {
  const norm = normalizar(etiqueta)
  return lista.find((c) => c.etiqueta === etiqueta) ?? lista.find((c) => normalizar(c.etiqueta) === norm)
}

/**
 * Traduce las etiquetas que pide el modelo a las etiquetas EXACTAS de la plantilla (por igualdad o
 * por normalización). Las que no existen en la plantilla se devuelven aparte para reportarlas.
 */
export function resolverEtiquetas(
  pedidas: readonly string[],
  plantilla: readonly CampoSolicitado[],
): { etiquetas: string[]; no_encontradas: string[] } {
  const etiquetas: string[] = []
  const no_encontradas: string[] = []
  for (const pedida of pedidas) {
    const campo = buscarPorEtiqueta(plantilla, pedida)
    if (!campo) no_encontradas.push(pedida)
    else if (!etiquetas.includes(campo.etiqueta)) etiquetas.push(campo.etiqueta)
  }
  return { etiquetas, no_encontradas }
}

/** Deja en el mapeo solo las etiquetas indicadas (para responder lo que pidió el modelo). */
export function filtrarMapeo(m: Mapeo, etiquetas: readonly string[]): Mapeo {
  const incluida = (c: { etiqueta: string }): boolean => etiquetas.includes(c.etiqueta)
  return {
    ...m,
    llenos: m.llenos.filter(incluida),
    faltantes: m.faltantes.filter(incluida),
    requiere_confirmacion: m.requiere_confirmacion.filter(incluida),
  }
}

/** Valor a escribir en el formulario para una etiqueta (llenos y propuestos por confirmar). */
export function valorParaFormulario(
  mapeo: Mapeo,
  etiqueta: string,
): { valor: string; estado: "lleno" | "requiere_confirmacion"; nota?: string } | { valor: ""; estado: "faltante"; nota: string } {
  const lleno = buscarPorEtiqueta(mapeo.llenos, etiqueta)
  if (lleno) return { valor: lleno.valor, estado: "lleno" }
  const pc = buscarPorEtiqueta(mapeo.requiere_confirmacion, etiqueta)
  if (pc) return { valor: pc.valor_propuesto, estado: "requiere_confirmacion", nota: pc.motivo }
  const f = buscarPorEtiqueta(mapeo.faltantes, etiqueta)
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
