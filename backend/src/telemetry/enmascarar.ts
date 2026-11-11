import type { SpanProcessor } from "@opentelemetry/sdk-trace-node"

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

type SpanMutable = Parameters<NonNullable<SpanProcessor["onEnding"]>>[0]

/**
 * Procesador que enmascara TODOS los atributos de texto de cada span justo antes de que termine
 * (hook onEnding, cuando el span aún se puede modificar). Se registra antes de los exportadores,
 * así cubre también los spans del SDK del modelo, no solo los del agente.
 */
export function crearProcesadorEnmascarado(enmascarar: Enmascarador): SpanProcessor {
  return {
    onStart() {},
    onEnding(span: SpanMutable) {
      for (const [clave, valor] of Object.entries(span.attributes)) {
        if (typeof valor !== "string") continue
        const limpio = enmascarar(valor)
        if (limpio !== valor && typeof limpio === "string") span.setAttribute(clave, limpio)
      }
    },
    onEnd() {},
    forceFlush: async () => {},
    shutdown: async () => {},
  }
}
