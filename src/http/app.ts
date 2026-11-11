import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative, resolve, sep } from "node:path"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { secureHeaders } from "hono/secure-headers"
import { z } from "zod"
import type { DependenciasCiclo } from "../agent/ciclo.ts"
import { conversar } from "../agent/servicio.ts"
import { type AlmacenSesiones, SESION_ID_RE } from "../agent/sesiones.ts"
import type { Configuracion } from "../config.ts"
import type { EstadoTelemetria } from "../telemetry/index.ts"
import { leerCaso } from "../tools/lib/datos.ts"
import { listarCasos } from "../tools/lib/rutas.ts"
import { exigirClave, limitarSolicitudes } from "./seguridad.ts"

export interface OpcionesApp {
  config: Configuracion
  raiz: string
  almacen: AlmacenSesiones
  /** `null` si no hay clave del modelo: la API responde 503 en /api/chat y el resto funciona. */
  ciclo: DependenciasCiclo | null
  telemetria: EstadoTelemetria
  dirWeb?: string
}

const TIPOS: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".jsonl": "application/x-ndjson",
  ".json": "application/json",
}

/**
 * API HTTP (PRD §6.4). Diseño:
 *   GET  /api/health          estado, proveedor y modelo (sin claves)
 *   GET  /api/casos           casos disponibles
 *   POST /api/chat            { sessionId?, message, confirm? } → { sessionId, reply, toolCalls, needsConfirmation, ... }
 *   GET  /api/sessions/:id    historial completo visible de la sesión
 *   GET  /api/archivos/*      descarga de archivos generados en out/ (solo lectura)
 */
export function crearApp(o: OpcionesApp): Hono {
  const app = new Hono()
  const { config } = o
  const dirOut = resolve(o.raiz, "out")

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  )
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Mensaje demasiado grande" }, 413) }))

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      provider: config.llm.proveedor,
      model: config.llm.modelo,
      llmConfigured: o.ciclo !== null,
      version: config.version,
      accessKeyRequired: Boolean(config.claveAcceso),
      telemetry: o.telemetria,
    }),
  )

  app.use("/api/*", exigirClave(config.claveAcceso))

  app.get("/api/casos", (c) => {
    const casos = listarCasos({ directory: o.raiz }).map((caso) => {
      try {
        const { solicitud } = leerCaso({ directory: o.raiz }, caso)
        return { caso, cliente: solicitud.cliente, pais: solicitud.pais, formato: solicitud.formato }
      } catch {
        return { caso, cliente: null, pais: null, formato: null }
      }
    })
    return c.json({ casos })
  })

  const CuerpoChat = z.object({
    sessionId: z.string().regex(SESION_ID_RE).optional(),
    message: z.string().trim().min(1).max(config.limites.caracteresMensaje),
    confirm: z.boolean().optional(),
  })

  app.post("/api/chat", limitarSolicitudes(config.limites.solicitudesPorMinuto), async (c) => {
    const cuerpo = CuerpoChat.safeParse(await c.req.json().catch(() => null))
    if (!cuerpo.success) {
      return c.json(
        { error: `Solicitud inválida: ${cuerpo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` },
        400,
      )
    }
    if (!o.ciclo) return c.json({ error: "El modelo de lenguaje no está configurado en el servidor (falta la clave)." }, 503)

    const r = await conversar(o.ciclo, o.almacen, {
      sessionId: cuerpo.data.sessionId,
      texto: cuerpo.data.message,
      ...(cuerpo.data.confirm === undefined ? {} : { confirmar: cuerpo.data.confirm }),
    })
    if (r.tipo === "ocupada") return c.json({ error: "La sesión está procesando otro mensaje. Espera la respuesta." }, 409)
    const { resultado, sesion } = r
    return c.json({
      sessionId: sesion.id,
      reply: resultado.reply,
      toolCalls: resultado.toolCalls,
      needsConfirmation: resultado.needsConfirmation,
      pendingAction: resultado.pendiente,
      error: resultado.error ?? null,
      iterations: resultado.iteraciones,
      usage: { ...resultado.uso, sessionLimit: config.limites.tokensPorSesion },
    })
  })

  app.get("/api/sessions/:id", (c) => {
    const id = c.req.param("id")
    const sesion = SESION_ID_RE.test(id) ? o.almacen.obtener(id) : undefined
    if (!sesion) return c.json({ error: "Sesión no encontrada o expirada" }, 404)
    return c.json({
      sessionId: sesion.id,
      createdAt: new Date(sesion.creada).toISOString(),
      updatedAt: new Date(sesion.actualizada).toISOString(),
      messages: sesion.transcripcion,
      pendingAction: sesion.pendiente,
      usage: { ...sesion.uso, sessionLimit: config.limites.tokensPorSesion },
    })
  })

  app.get("/api/archivos/*", (c) => {
    const pedido = decodeURIComponent(c.req.path.replace(/^\/api\/archivos\//, ""))
    const destino = resolve(o.raiz, pedido)
    const rel = relative(dirOut, destino)
    // Solo archivos dentro de out/: bloquea `..`, rutas absolutas y cualquier otra carpeta.
    if (!pedido.startsWith("out/") || rel.startsWith("..") || rel.startsWith(sep) || rel === "") {
      return c.json({ error: "Ruta no permitida" }, 403)
    }
    if (!existsSync(destino) || !statSync(destino).isFile()) return c.json({ error: "Archivo no encontrado" }, 404)
    const nombre = destino.split(sep).pop() ?? "archivo"
    return c.body(readFileSync(destino), 200, {
      "Content-Type": TIPOS[extname(destino).toLowerCase()] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nombre.replaceAll('"', "")}"`,
      "Cache-Control": "no-store",
    })
  })

  app.notFound((c) =>
    c.req.path.startsWith("/api/") ? c.json({ error: "Ruta no encontrada" }, 404) : c.text("No encontrado", 404),
  )
  app.onError((e, c) => {
    process.stderr.write(`${JSON.stringify({ nivel: "error", ruta: c.req.path, error: e.message })}\n`)
    return c.json({ error: "Error interno del servidor" }, 500)
  })

  const web = o.dirWeb ?? join(o.raiz, "web")
  app.use("/*", serveStatic({ root: relative(process.cwd(), web) || "." }))
  return app
}
