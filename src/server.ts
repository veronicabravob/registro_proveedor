/**
 * Punto de entrada: configuración → telemetría → modelo → ciclo del agente → HTTP.
 * La telemetría se inicia antes de crear el cliente del modelo para que sus spans queden trazados.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { BitacoraGlobal } from "./agent/bitacora.ts"
import type { DependenciasCiclo } from "./agent/ciclo.ts"
import { cargarSistema } from "./agent/prompt.ts"
import { AlmacenSesiones } from "./agent/sesiones.ts"
import { cargarConfiguracion } from "./config.ts"
import { crearApp } from "./http/app.ts"
import { crearAdaptador } from "./llm/index.ts"
import { crearEnmascarador } from "./telemetry/enmascarar.ts"
import { iniciarTelemetria } from "./telemetry/index.ts"
import { herramientas } from "./tools/index.ts"
import { valoresSensibles } from "./tools/lib/sensibles.ts"

const log = (nivel: "info" | "warn" | "error", mensaje: string, extra: Record<string, unknown> = {}): void => {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), nivel, mensaje, ...extra })}\n`)
}

const raiz = fileURLToPath(new URL("..", import.meta.url))
const config = cargarConfiguracion()
const almacen = new AlmacenSesiones(config.limites.sesiones, config.limites.ttlSesionMs)
const telemetria = iniciarTelemetria(config, crearEnmascarador(valoresSensibles({ directory: raiz })), () => almacen.tamano)
const llm = crearAdaptador(config)
if (!llm) log("warn", "Sin ANTHROPIC_API_KEY: el chat responderá 503; demo.ts y el resto de la API funcionan.")

const ciclo: DependenciasCiclo | null = llm
  ? {
      llm,
      herramientas,
      sistema: cargarSistema(raiz),
      directorio: raiz,
      limites: { iteraciones: config.limites.iteracionesPorTurno, tokensSesion: config.limites.tokensPorSesion },
      ...(config.fechaEjecucion ? { fechaEjecucion: config.fechaEjecucion } : {}),
      observador: telemetria.observador,
      bitacora: new BitacoraGlobal(join(raiz, "out")),
    }
  : null

const app = crearApp({ config, raiz, almacen, ciclo, telemetria: telemetria.estado })
const servidor = serve({ fetch: app.fetch, port: config.puerto }, (info) => {
  // Nunca se registra la clave: solo proveedor, modelo y destinos de telemetría.
  log("info", `Servidor en http://localhost:${info.port}`, {
    proveedor: config.llm.proveedor,
    modelo: config.llm.modelo,
    telemetria: telemetria.estado,
    claveAcceso: Boolean(config.claveAcceso),
  })
})

async function apagar(senal: string): Promise<void> {
  log("info", `Apagando (${senal})`)
  servidor.close()
  await telemetria.apagar().catch(() => undefined)
  process.exit(0)
}
process.on("SIGTERM", () => void apagar("SIGTERM"))
process.on("SIGINT", () => void apagar("SIGINT"))
