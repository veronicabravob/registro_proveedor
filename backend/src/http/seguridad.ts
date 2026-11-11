import { createHash, timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"

/** Comparación en tiempo constante (evita ataques de temporización sobre la clave de acceso). */
export function claveValida(recibida: string | undefined, esperada: string): boolean {
  if (!recibida) return false
  const a = createHash("sha256").update(recibida).digest()
  const b = createHash("sha256").update(esperada).digest()
  return timingSafeEqual(a, b)
}

/** Si APP_ACCESS_KEY está definida, exige el header `x-access-key`. */
export function exigirClave(esperada: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!esperada || claveValida(c.req.header("x-access-key"), esperada)) return next()
    return c.json({ error: "Clave de acceso requerida o inválida" }, 401)
  }
}

/**
 * Límite de solicitudes por IP en ventana deslizante de 60 s, en memoria.
 * Protege la clave del modelo de un uso sin límite (PRD §8 Costo).
 */
export function limitarSolicitudes(porMinuto: number, ahora: () => number = Date.now): MiddlewareHandler {
  const ventanas = new Map<string, number[]>()
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local"
    const t = ahora()
    const recientes = (ventanas.get(ip) ?? []).filter((x) => t - x < 60_000)
    if (recientes.length >= porMinuto) {
      c.header("Retry-After", "60")
      return c.json({ error: "Demasiadas solicitudes. Espera un minuto e intenta de nuevo." }, 429)
    }
    recientes.push(t)
    ventanas.set(ip, recientes)
    if (ventanas.size > 10_000) ventanas.clear()
    return next()
  }
}
