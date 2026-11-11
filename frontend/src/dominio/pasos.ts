import type { Caso, Llamada } from "../api/tipos.ts"

/**
 * Traduce los pasos técnicos del agente al lenguaje de la analista. El nombre técnico de la
 * herramienta y sus datos siguen disponibles (PRD §6.1), pero en segundo plano.
 */

export type Tono = "ok" | "error" | "aviso"

export interface PasoLegible {
  titulo: string
  detalle: string
  tono: Tono
}

const EN_CURSO: Record<string, { titulo: string; detalle: string }> = {
  pensando: { titulo: "Estoy pensando el siguiente paso.", detalle: "" },
  proveedor_leer_solicitud: { titulo: "Estoy leyendo la solicitud.", detalle: "Reviso qué pide el cliente." },
  proveedor_mapear_campos: { titulo: "Estoy cruzando los campos con el maestro.", detalle: "Busco cada dato y su fuente." },
  proveedor_generar_formulario: { titulo: "Estoy llenando el formulario.", detalle: "En el mismo formato que envió el cliente." },
  proveedor_armar_paquete: { titulo: "Estoy armando el paquete.", detalle: "Reviso qué soportes están vigentes." },
  proveedor_solicitar_confirmacion: { titulo: "Preparo la pregunta para ti.", detalle: "Antes de cualquier envío." },
  proveedor_simular_envio: { titulo: "Estoy registrando el envío simulado.", detalle: "No sale ningún correo real." },
}

export function pasoEnCurso(nombre: string): { titulo: string; detalle: string } {
  return EN_CURSO[nombre] ?? { titulo: "Estoy trabajando en tu solicitud.", detalle: "" }
}

/** Quita rutas de archivo del resumen: se ofrecen aparte como descargas. */
const sinRuta = (texto: string): string =>
  texto
    .replace(/:\s*out\/\S+$/, ".")
    .replace(/\s*out\/\S+/g, "")
    .trim()

export function describirPaso(l: Llamada): PasoLegible {
  if (!l.ok) return describirError(l)
  const detalle = sinRuta(l.resumen)
  switch (l.nombre) {
    case "proveedor_leer_solicitud":
      return { titulo: "Leí la solicitud.", detalle, tono: "ok" }
    case "proveedor_mapear_campos":
      return { titulo: "Crucé los campos con el maestro.", detalle, tono: "ok" }
    case "proveedor_generar_formulario":
      return /portal/i.test(l.resumen)
        ? {
            titulo: "No pude generar el formulario.",
            detalle: "Este cliente usa un portal web: te dejé los valores listos para copiar.",
            tono: "aviso",
          }
        : { titulo: "Generé el formulario", detalle: "en el mismo formato que envió el cliente.", tono: "ok" }
    case "proveedor_armar_paquete":
      return /^Listo/.test(l.resumen)
        ? { titulo: "Armé el paquete y está listo para firma.", detalle: "Todos los soportes están vigentes.", tono: "ok" }
        : {
            titulo: "Armé el paquete, pero no está listo para firma.",
            detalle: detalle.replace(/^No está listo para firma:\s*/, "Hay "),
            tono: "aviso",
          }
    case "proveedor_solicitar_confirmacion":
      return { titulo: "Te pedí confirmación", detalle: "antes de registrar el envío.", tono: "ok" }
    case "proveedor_simular_envio":
      return { titulo: "Registré el envío simulado", detalle: "con tu confirmación. No salió ningún correo real.", tono: "ok" }
    default:
      return { titulo: "Paso completado.", detalle, tono: "ok" }
  }
}

function describirError(l: Llamada): PasoLegible {
  const titulos: Record<string, string> = {
    proveedor_leer_solicitud: "No pude leer la solicitud.",
    proveedor_mapear_campos: "No pude cruzar los campos.",
    proveedor_generar_formulario: "No pude generar el formulario.",
    proveedor_armar_paquete: "No pude armar el paquete.",
    proveedor_simular_envio: "No registré el envío.",
  }
  const detalle = l.resumen === "requiere confirmación explícita" ? "Primero necesito tu confirmación explícita." : l.resumen
  return { titulo: titulos[l.nombre] ?? "No pude completar este paso.", detalle, tono: "error" }
}

// ── Progreso del caso: los 5 puntos del logo ─────────────────────────────────

export type EstadoPunto = "hecho" | "error" | "curso" | "pendiente"

const ETAPAS: readonly (readonly string[])[] = [
  ["proveedor_leer_solicitud"],
  ["proveedor_mapear_campos"],
  ["proveedor_generar_formulario"],
  ["proveedor_armar_paquete"],
  ["proveedor_simular_envio"],
]

export interface Progreso {
  puntos: EstadoPunto[]
  hechos: number
  etiqueta: string
}

export function calcularProgreso(llamadas: readonly Llamada[], enCurso: string | null): Progreso {
  const puntos: EstadoPunto[] = ETAPAS.map((nombres) => {
    const ultimas = llamadas.filter((l) => nombres.includes(l.nombre))
    const ultima = ultimas.at(-1)
    if (enCurso && nombres.includes(enCurso)) return "curso"
    if (!ultima) return "pendiente"
    if (!ultima.ok) return "error"
    return describirPaso(ultima).tono === "aviso" ? "error" : "hecho"
  })
  const hechos = puntos.filter((p) => p === "hecho" || p === "error").length
  return { puntos, hechos, etiqueta: etiquetaProgreso(llamadas, puntos, enCurso) }
}

function etiquetaProgreso(llamadas: readonly Llamada[], puntos: readonly EstadoPunto[], enCurso: string | null): string {
  if (enCurso)
    return pasoEnCurso(enCurso)
      .titulo.replace(/^Estoy /, "")
      .replace(/\.$/, "")
  if (puntos[4] === "hecho") return "todo completo"
  const paquete = llamadas.filter((l) => l.nombre === "proveedor_armar_paquete").at(-1)
  if (paquete?.ok) return /^Listo/.test(paquete.resumen) ? "listo para firma" : "el paquete tiene un bloqueo"
  return puntos.some((p) => p !== "pendiente") ? "en proceso" : "sin empezar"
}

// ── Datos del caso ───────────────────────────────────────────────────────────

export function casoDe(llamadas: readonly Llamada[]): string | null {
  for (const l of [...llamadas].reverse()) {
    const caso = (l.args as { caso?: unknown } | null)?.caso
    if (typeof caso === "string") return caso
  }
  return null
}

const PAISES: Record<string, string> = { CO: "Colombia", EC: "Ecuador", PE: "Perú", PA: "Panamá", HN: "Honduras" }
export const nombrePais = (codigo: string | null): string => (codigo ? (PAISES[codigo] ?? codigo) : "")

export function nombreFormato(formato: Caso["formato"]): string {
  if (formato === "xlsx") return "Plantilla de Excel"
  if (formato === "pdf") return "Formulario PDF"
  if (formato === "portal") return "Portal web · te dejo los valores para copiar"
  return ""
}

export function piden(formato: Caso["formato"]): string {
  if (formato === "xlsx") return "piden plantilla Excel"
  if (formato === "pdf") return "piden formulario PDF"
  if (formato === "portal") return "piden llenar su portal web"
  return ""
}

/** Nombre corto para la conversación: "Corporación Andina de Servicios S.A." → "Corporación Andina". */
export function nombreCorto(cliente: string): string {
  const SUFIJO = /[\s,]+(S\.?\s?de\s?R\.?\s?L\.?|S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|Ltda\.?|de Servicios|Group)\s*$/i
  let nombre = cliente.trim()
  for (let previo = ""; previo !== nombre; ) {
    previo = nombre
    nombre = nombre.replace(SUFIJO, "").trim()
  }
  return nombre
}

// ── Archivos para descargar ──────────────────────────────────────────────────

const RUTA = /out\/[a-z0-9-]+\/[A-Za-z0-9._\-/]+\.(?:xlsx|pdf|md)/g

export function archivosEn(...textos: readonly string[]): string[] {
  const rutas = new Set<string>()
  for (const t of textos) for (const m of t.matchAll(RUTA)) rutas.add(m[0])
  return [...rutas]
}

/** Archivos que la analista necesita del paquete (formulario, checklist, borrador, envío). */
export function archivosDelCaso(caso: string, llamadas: readonly Llamada[]): string[] {
  const rutas = new Set(archivosEn(...llamadas.map((l) => l.resumen)))
  const paquete = llamadas.find((l) => l.nombre === "proveedor_armar_paquete" && l.ok)
  if (paquete) {
    rutas.add(`out/${caso}/paquete/checklist.md`)
    rutas.add(`out/${caso}/paquete/borrador-correo.md`)
  }
  return [...rutas]
}

/** Quita rutas internas de un texto escrito para la analista. */
export const sinRutas = (texto: string): string =>
  texto
    .replace(/\s*`?out\/[^\s)`]+`?/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()

export const nombreArchivo = (ruta: string): string => ruta.split("/").pop() ?? ruta

export function duracion(ms: number): string {
  if (ms < 100) return "< 0,1 s"
  return `${(ms / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`
}
