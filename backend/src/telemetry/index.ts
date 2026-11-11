import { isDefaultExportSpan, LangfuseSpanProcessor } from "@langfuse/otel"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { ConsoleMetricExporter, type IMetricReader, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-node"
import type { Observador } from "../agent/observador.ts"
import type { Configuracion } from "../config.ts"
import { crearProcesadorEnmascarado, type Enmascarador } from "./enmascarar.ts"
import { crearObservadorOtel, NOMBRE_INSTRUMENTACION } from "./observador-otel.ts"

export interface EstadoTelemetria {
  trazas: string[]
  metricas: string[]
  contenido: "metadata_only" | "content"
}

export interface Telemetria {
  observador: Observador
  estado: EstadoTelemetria
  apagar(): Promise<void>
}

/**
 * Inicializa OpenTelemetry ANTES de crear el cliente del modelo: el SDK de Anthropic usa el
 * proveedor global y emite sus propios spans `anthropic.messages.create` con `gen_ai.*`,
 * que quedan anidados bajo el span del turno del agente.
 *
 * Destinos (todos opcionales y combinables):
 *  - Langfuse (LANGFUSE_PUBLIC_KEY/SECRET_KEY): trazas del agente por sesión, con enmascarado.
 *  - OTLP/HTTP genérico (OTEL_EXPORTER_OTLP_ENDPOINT): trazas y métricas a cualquier backend.
 *  - Consola (METRICS_CONSOLE=true): métricas en stdout para desarrollo.
 */
export function iniciarTelemetria(config: Configuracion, enmascarar: Enmascarador, sesionesActivas?: () => number): Telemetria {
  const t = config.telemetria
  const estado: EstadoTelemetria = { trazas: [], metricas: [], contenido: t.contenido }
  const spanProcessors: SpanProcessor[] = []
  const metricReaders: IMetricReader[] = []

  if (t.langfuse) {
    spanProcessors.push(
      new LangfuseSpanProcessor({
        publicKey: t.langfuse.publicKey,
        secretKey: t.langfuse.secretKey,
        baseUrl: t.langfuse.baseUrl,
        environment: config.entorno,
        release: config.version,
        mask: ({ data }) => enmascarar(data),
        shouldExportSpan: ({ otelSpan }) =>
          isDefaultExportSpan(otelSpan) || otelSpan.instrumentationScope.name === NOMBRE_INSTRUMENTACION,
      }),
    )
    estado.trazas.push("langfuse")
  }
  if (t.otlpEndpoint) {
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter()))
    estado.trazas.push("otlp")
  }
  if (t.otlpEndpoint || t.otlpMetricsEndpoint) {
    metricReaders.push(
      new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: t.intervaloMetricasMs }),
    )
    estado.metricas.push("otlp")
  }
  if (t.metricasConsola) {
    metricReaders.push(
      new PeriodicExportingMetricReader({ exporter: new ConsoleMetricExporter(), exportIntervalMillis: t.intervaloMetricasMs }),
    )
    estado.metricas.push("consola")
  }

  // El enmascarado va primero: modifica los spans antes de que cualquier exportador los lea.
  if (spanProcessors.length) spanProcessors.unshift(crearProcesadorEnmascarado(enmascarar))

  let sdk: NodeSDK | undefined
  if (spanProcessors.length || metricReaders.length) {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": t.servicio,
        "service.version": config.version,
        "deployment.environment.name": config.entorno,
      }),
      spanProcessors,
      metricReaders,
    })
    sdk.start()
  }

  return {
    observador: crearObservadorOtel({
      proveedor: config.llm.proveedor,
      contenido: t.contenido,
      enmascarar,
      ...(sesionesActivas ? { sesionesActivas } : {}),
    }),
    estado,
    // Vacía los buffers al apagar (Render envía SIGTERM): no se pierden las últimas trazas.
    apagar: async () => {
      await sdk?.shutdown()
    },
  }
}
