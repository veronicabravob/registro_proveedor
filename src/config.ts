import { existsSync } from "node:fs"
import { z } from "zod"

/**
 * Configuración desde variables de entorno, validada con zod al arrancar (fail fast).
 * Los secretos solo se leen aquí y nunca se serializan: `describirConfiguracion` los omite.
 */
const booleano = z
  .enum(["true", "false", "1", "0", ""])
  .default("")
  .transform((v) => v === "true" || v === "1")

const opcional = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined))

const EntornoSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  LLM_PROVIDER: z.enum(["anthropic"]).default("anthropic"),
  LLM_MODEL: z.string().min(1).default("claude-opus-5-5"),
  LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  LLM_MAX_TOKENS: z.coerce.number().int().min(1024).max(128000).default(16000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(90000),
  LLM_FALLBACKS: z.enum(["true", "false"]).default("true"),
  ANTHROPIC_API_KEY: opcional,

  MAX_ITERATIONS_PER_TURN: z.coerce.number().int().min(1).max(100).default(25),
  MAX_TOKENS_PER_SESSION: z.coerce.number().int().min(10000).default(400000),
  MAX_SESSIONS: z.coerce.number().int().min(1).default(200),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(1).default(120),
  MAX_MESSAGE_CHARS: z.coerce.number().int().min(100).max(20000).default(4000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  APP_ACCESS_KEY: opcional,
  FECHA_EJECUCION: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),

  LANGFUSE_PUBLIC_KEY: opcional,
  LANGFUSE_SECRET_KEY: opcional,
  LANGFUSE_BASE_URL: z.string().url().default("https://cloud.langfuse.com"),
  OTEL_SERVICE_NAME: z.string().default("registro-proveedor"),
  OTEL_EXPORTER_OTLP_ENDPOINT: opcional,
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: opcional,
  TELEMETRY_CONTENT_MODE: z.enum(["metadata_only", "content"]).default("metadata_only"),
  METRICS_CONSOLE: booleano,
  METRICS_EXPORT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30000),
})

export interface Configuracion {
  entorno: "development" | "production" | "test"
  puerto: number
  version: string
  llm: {
    proveedor: "anthropic"
    modelo: string
    esfuerzo: "low" | "medium" | "high" | "xhigh" | "max"
    maxTokens: number
    timeoutMs: number
    fallbacks: boolean
    apiKey: string | undefined
  }
  limites: {
    iteracionesPorTurno: number
    tokensPorSesion: number
    sesiones: number
    ttlSesionMs: number
    caracteresMensaje: number
    solicitudesPorMinuto: number
  }
  claveAcceso: string | undefined
  fechaEjecucion: string | undefined
  telemetria: {
    servicio: string
    contenido: "metadata_only" | "content"
    langfuse: { publicKey: string; secretKey: string; baseUrl: string } | undefined
    otlpEndpoint: string | undefined
    otlpMetricsEndpoint: string | undefined
    metricasConsola: boolean
    intervaloMetricasMs: number
  }
}

/** Carga `.env` si existe (Node ≥ 21.7). En producción las variables las inyecta la plataforma. */
function cargarArchivoEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env")
}

export function cargarConfiguracion(env: NodeJS.ProcessEnv = process.env, leerArchivo = true): Configuracion {
  if (leerArchivo) cargarArchivoEnv()
  // Una variable vacía (`FECHA_EJECUCION=` copiada de .env.example) equivale a no definida.
  const definidas = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""))
  const r = EntornoSchema.safeParse(definidas)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Configuración inválida: ${detalle}`)
  }
  const e = r.data
  return {
    entorno: e.NODE_ENV,
    puerto: e.PORT,
    version: env.RENDER_GIT_COMMIT?.slice(0, 7) ?? env.npm_package_version ?? "dev",
    llm: {
      proveedor: e.LLM_PROVIDER,
      modelo: e.LLM_MODEL,
      esfuerzo: e.LLM_EFFORT,
      maxTokens: e.LLM_MAX_TOKENS,
      timeoutMs: e.LLM_TIMEOUT_MS,
      fallbacks: e.LLM_FALLBACKS === "true",
      apiKey: e.ANTHROPIC_API_KEY,
    },
    limites: {
      iteracionesPorTurno: e.MAX_ITERATIONS_PER_TURN,
      tokensPorSesion: e.MAX_TOKENS_PER_SESSION,
      sesiones: e.MAX_SESSIONS,
      ttlSesionMs: e.SESSION_TTL_MINUTES * 60_000,
      caracteresMensaje: e.MAX_MESSAGE_CHARS,
      solicitudesPorMinuto: e.RATE_LIMIT_PER_MINUTE,
    },
    claveAcceso: e.APP_ACCESS_KEY,
    fechaEjecucion: e.FECHA_EJECUCION,
    telemetria: {
      servicio: e.OTEL_SERVICE_NAME,
      contenido: e.TELEMETRY_CONTENT_MODE,
      langfuse:
        e.LANGFUSE_PUBLIC_KEY && e.LANGFUSE_SECRET_KEY
          ? { publicKey: e.LANGFUSE_PUBLIC_KEY, secretKey: e.LANGFUSE_SECRET_KEY, baseUrl: e.LANGFUSE_BASE_URL }
          : undefined,
      otlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT,
      otlpMetricsEndpoint: e.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
      metricasConsola: e.METRICS_CONSOLE,
      intervaloMetricasMs: e.METRICS_EXPORT_INTERVAL_MS,
    },
  }
}
