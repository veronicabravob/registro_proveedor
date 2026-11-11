/** Normaliza una etiqueta: minúsculas, sin tildes, solo letras y números separados por un espacio. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Raíz muy simple para español: quita plurales frecuentes. */
function raiz(palabra: string): string {
  if (palabra.length > 4 && palabra.endsWith("es")) return palabra.slice(0, -2)
  if (palabra.length > 3 && palabra.endsWith("s")) return palabra.slice(0, -1)
  return palabra
}

export function tokens(texto: string, vacias: ReadonlySet<string>): Set<string> {
  return new Set(
    normalizar(texto)
      .split(" ")
      .filter((t) => t.length > 0 && !vacias.has(t))
      .map(raiz),
  )
}

/** Coeficiente de Dice entre dos conjuntos de tokens (0 a 1). */
export function similitud(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let comunes = 0
  for (const t of a) if (b.has(t)) comunes++
  return (2 * comunes) / (a.size + b.size)
}

/** Fecha local `YYYY-MM-DD`. */
export function hoyISO(fecha: Date = new Date()): string {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, "0")
  const d = String(fecha.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
