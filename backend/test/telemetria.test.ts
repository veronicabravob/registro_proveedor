import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { metrics } from "@opentelemetry/api"
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics"
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node"
import { BitacoraGlobal } from "../src/agent/bitacora.ts"
import { ejecutarTurno } from "../src/agent/ciclo.ts"
import { AlmacenSesiones } from "../src/agent/sesiones.ts"
import { cargarConfiguracion } from "../src/config.ts"
import type { AdaptadorLlm, Respuesta } from "../src/llm/adapter.ts"
import { crearEnmascarador } from "../src/telemetry/enmascarar.ts"
import { iniciarTelemetria } from "../src/telemetry/index.ts"
import { crearObservadorOtel } from "../src/telemetry/observador-otel.ts"
import { herramientas } from "../src/tools/index.ts"
import { valoresSensibles } from "../src/tools/lib/sensibles.ts"

const raiz = fileURLToPath(new URL("../..", import.meta.url))
const spans = new InMemorySpanExporter()
const metricas = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
const lector = new PeriodicExportingMetricReader({ exporter: metricas, exportIntervalMillis: 60_000 })
let dir: string

before(() => {
  new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }).register()
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [lector] }))
  dir = mkdtempSync(join(tmpdir(), "reto01-otel-"))
  cpSync(join(raiz, "fixtures"), join(dir, "fixtures"), { recursive: true })
})
after(() => rmSync(dir, { recursive: true, force: true }))

const uso = { entrada: 120, salida: 30, cacheLectura: 100, cacheEscritura: 0 }
function guion(respuestas: Respuesta[]): AdaptadorLlm {
  return { proveedor: "anthropic", modelo: "guion", enviar: async () => respuestas.shift() ?? assert.fail("guion agotado") }
}

describe("enmascarado", () => {
  it("reemplaza los valores sensibles del maestro en cualquier estructura", () => {
    const sensibles = valoresSensibles({ directory: raiz })
    assert.ok(sensibles.includes("03100012345"))
    const m = crearEnmascarador(sensibles)
    assert.deepEqual(m({ a: ["cuenta 03100012345", 7], b: { swift: "COLOCOBM" } }), { a: ["cuenta ***", 7], b: { swift: "***" } })
  })
})

describe("observador OpenTelemetry", () => {
  it("emite spans de agente y herramienta con atributos GenAI y de Langfuse, enmascarados", async () => {
    const observador = crearObservadorOtel({
      proveedor: "anthropic",
      contenido: "content",
      enmascarar: crearEnmascarador(valoresSensibles({ directory: raiz })),
      sesionesActivas: () => 1,
    })
    const llm = guion([
      {
        mensaje: {
          rol: "asistente",
          partes: [{ tipo: "llamada", id: "t1", nombre: "proveedor_leer_solicitud", args: { caso: "co-industrias-delta" } }],
        },
        motivo: "herramientas",
        uso,
        modelo: "guion",
      },
      {
        mensaje: { rol: "asistente", partes: [{ tipo: "texto", texto: "Cuenta 03100012345 lista" }] },
        motivo: "fin_turno",
        uso,
        modelo: "guion",
      },
    ])
    const sesion = new AlmacenSesiones(5, 60_000).crear("sesion-otel-1")
    await ejecutarTurno(
      {
        llm,
        herramientas,
        sistema: "s",
        directorio: dir,
        limites: { iteraciones: 5, tokensSesion: 100_000 },
        observador,
        bitacora: new BitacoraGlobal(join(dir, "out")),
      },
      sesion,
      { texto: "procesa co-industrias-delta" },
    )

    const terminados = spans.getFinishedSpans()
    const turno = terminados.find((s) => s.name === "invoke_agent registro-proveedor")
    const tool = terminados.find((s) => s.name === "execute_tool proveedor_leer_solicitud")
    assert.ok(turno && tool)
    assert.equal(turno.attributes["langfuse.session.id"], "sesion-otel-1")
    assert.equal(turno.attributes["langfuse.observation.type"], "agent")
    assert.equal(turno.attributes["langfuse.trace.output"], "Cuenta *** lista")
    assert.equal(tool.attributes["gen_ai.tool.name"], "proveedor_leer_solicitud")
    assert.equal(tool.parentSpanContext?.spanId, turno.spanContext().spanId)

    await lector.forceFlush()
    const nombres = metricas.getMetrics().flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics.map((m) => m.descriptor.name)))
    for (const n of ["gen_ai.client.token.usage", "agente.turnos", "agente.herramienta.llamadas", "agente.sesiones.activas"]) {
      assert.ok(nombres.includes(n), n)
    }
  })

  it("en modo metadata_only no exporta el texto del usuario", async () => {
    spans.reset()
    const observador = crearObservadorOtel({ proveedor: "anthropic", contenido: "metadata_only", enmascarar: (d) => d })
    await observador.envolver("turno", { sesionId: "s-123456", nombre: "t" }, async (t) => {
      t.entrada("dato privado")
      t.error("falló")
    })
    const span = spans.getFinishedSpans()[0]
    assert.equal(span?.attributes["langfuse.trace.input"], undefined)
    assert.equal(span?.attributes["langfuse.observation.level"], "ERROR")
  })
})

describe("iniciarTelemetria", () => {
  it("sin destinos configurados no arranca el SDK y reporta el estado", async () => {
    const config = cargarConfiguracion({ NODE_ENV: "test" }, false)
    const t = iniciarTelemetria(config, (d) => d)
    assert.deepEqual(t.estado, { trazas: [], metricas: [], contenido: "metadata_only" })
    await t.apagar()
  })
})

describe("iniciarTelemetria con destinos", () => {
  it("arranca Langfuse y métricas en consola, y apaga vaciando buffers", async () => {
    const config = cargarConfiguracion(
      {
        NODE_ENV: "test",
        LANGFUSE_PUBLIC_KEY: "pk-lf-prueba",
        LANGFUSE_SECRET_KEY: "sk-lf-prueba",
        LANGFUSE_BASE_URL: "http://127.0.0.1:9",
        METRICS_CONSOLE: "true",
        TELEMETRY_CONTENT_MODE: "content",
      },
      false,
    )
    const t = iniciarTelemetria(
      config,
      (d) => d,
      () => 0,
    )
    assert.deepEqual(t.estado, { trazas: ["langfuse"], metricas: ["consola"], contenido: "content" })
    await t.apagar()
  })
})

describe("procesador de enmascarado", () => {
  it("enmascara atributos de cualquier span (también los del SDK del modelo) antes de exportar", async () => {
    const { crearProcesadorEnmascarado } = await import("../src/telemetry/enmascarar.ts")
    const memoria = new InMemorySpanExporter()
    const proveedorTrazas = new NodeTracerProvider({
      spanProcessors: [
        crearProcesadorEnmascarado(crearEnmascarador(valoresSensibles({ directory: raiz }))),
        new SimpleSpanProcessor(memoria),
      ],
    })
    const span = proveedorTrazas.getTracer("com.anthropic.sdk.typescript").startSpan("anthropic.messages.create")
    span.setAttribute(
      "gen_ai.input.messages",
      JSON.stringify([{ role: "user", content: '{"valor":"03100012345","swift":"COLOCOBM"}' }]),
    )
    span.setAttribute("gen_ai.usage.input_tokens", 120)
    span.end()
    const exportado = memoria.getFinishedSpans()[0]
    assert.doesNotMatch(String(exportado?.attributes["gen_ai.input.messages"]), /03100012345|COLOCOBM/)
    assert.equal(exportado?.attributes["gen_ai.usage.input_tokens"], 120)
    await proveedorTrazas.shutdown()
  })
})
