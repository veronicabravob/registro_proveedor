/**
 * Enmascarado de datos sensibles antes de exportar trazas (NIST AI RMF: privacidad).
 * Se construye con los valores sensibles reales del maestro (cuenta, SWIFT, cédula), de modo que
 * cualquier aparición literal en prompts, argumentos o resultados se reemplaza antes de salir del proceso.
 */
export type Enmascarador = (dato: unknown) => unknown

const MARCA = "***"

export function crearEnmascarador(valoresSensibles: readonly string[]): Enmascarador {
  const valores = [...new Set(valoresSensibles.filter((v) => v.length >= 4))].sort((a, b) => b.length - a.length)
  const enmascararTexto = (texto: string): string => valores.reduce((t, v) => t.split(v).join(MARCA), texto)

  const recorrer = (dato: unknown, profundidad: number): unknown => {
    if (profundidad > 20) return dato
    if (typeof dato === "string") return enmascararTexto(dato)
    if (Array.isArray(dato)) return dato.map((d) => recorrer(d, profundidad + 1))
    if (dato && typeof dato === "object") {
      return Object.fromEntries(Object.entries(dato).map(([k, v]) => [k, recorrer(v, profundidad + 1)]))
    }
    return dato
  }
  return (dato) => recorrer(dato, 0)
}
