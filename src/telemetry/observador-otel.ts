import { type Attributes, metrics, type Span, SpanStatusCode, trace } from "@opentelemetry/api"
import type { Atributo, ContextoTramo, EventoAgente, Observador, TipoTramo, Tramo } from "../agent/observador.ts"
import type { Enmascarador } from "./enmascarar.ts"

export const NOMBRE_INSTRUMENTACION = "registro-proveedor.agente"

export interface OpcionesObservador {
  proveedor: string
  /** `content`: incluye mensaje del usuario y respuesta en la traza (enmascarados). */
  contenido: "metadata_only" | "content"
  enmascarar: Enmascarador
  sesionesActivas?: () => number
}

const serializar = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v))

/**
 * Implementación OpenTelemetry del puerto Observador.
 * - Trazas: atributos GenAI semconv (`gen_ai.*`) + atributos de Langfuse (`langfuse.*`), de modo que
 *   Langfuse agrupa por sesión y muestra el turno como "agent" y cada herramienta como "tool".
 * - Métricas: tokens y duración GenAI (semconv) + métricas de negocio del proceso.
 */
export function crearObservadorOtel(o: OpcionesObservador): Observador {
  const tracer = trace.getTracer(NOMBRE_INSTRUMENTACION)
  const m = crearMetricas(o)

  const tramoDe = (span: Span, tipo: TipoTramo): Tramo => {
    const conContenido = tipo === "herramienta" || o.contenido === "content"
    return {
      atributos: (a) => span.setAttributes(limpiar(a)),
      entrada: (v) => {
        if (!conContenido) return
        const valor = serializar(o.enmascarar(v))
        span.setAttribute("langfuse.observation.input", valor)
        if (tipo === "turno") span.setAttribute("langfuse.trace.input", valor)
      },
      salida: (v) => {
        if (!conContenido) return
        const valor = serializar(o.enmascarar(v))
        span.setAttribute("langfuse.observation.output", valor)
        if (tipo === "turno") span.setAttribute("langfuse.trace.output", valor)
      },
      error: (mensaje) => {
        span.setStatus({ code: SpanStatusCode.ERROR, message: mensaje })
        span.setAttributes({ "langfuse.observation.level": "ERROR", "langfuse.observation.status_message": mensaje })
      },
    }
  }

  return {
    envolver: (tipo, ctx, fn) =>
      tracer.startActiveSpan(nombreTramo(tipo, ctx), { attributes: atributosIniciales(tipo, ctx) }, async (span) => {
        try {
          return await fn(tramoDe(span, tipo))
        } catch (e) {
          span.recordException(e instanceof Error ? e : new Error(String(e)))
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw e
        } finally {
          span.end()
        }
      }),
    evento: (e) => m.registrar(e),
  }
}

function nombreTramo(tipo: TipoTramo, ctx: ContextoTramo): string {
  return tipo === "turno" ? "invoke_agent registro-proveedor" : `execute_tool ${ctx.nombre}`
}

function atributosIniciales(tipo: TipoTramo, ctx: ContextoTramo): Attributes {
  const comunes = { "gen_ai.conversation.id": ctx.sesionId, "langfuse.session.id": ctx.sesionId }
  if (tipo === "turno") {
    return {
      ...comunes,
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "registro-proveedor",
      "langfuse.observation.type": "agent",
      "langfuse.trace.name": "registro-proveedor.turno",
    }
  }
  return {
    ...comunes,
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": ctx.nombre,
    "gen_ai.tool.type": "function",
    "langfuse.observation.type": "tool",
  }
}

function limpiar(a: Readonly<Record<string, Atributo | undefined>>): Attributes {
  return Object.fromEntries(
    Object.entries(a)
      .filter((e): e is [string, Atributo] => e[1] !== undefined)
      .map(([k, v]) => [`agente.${k}`, v]),
  )
}

function crearMetricas(o: OpcionesObservador): { registrar(e: EventoAgente): void } {
  const meter = metrics.getMeter(NOMBRE_INSTRUMENTACION)
  const tokens = meter.createHistogram("gen_ai.client.token.usage", {
    unit: "{token}",
    description: "Tokens por llamada al modelo",
  })
  const duracionLlm = meter.createHistogram("gen_ai.client.operation.duration", {
    unit: "s",
    description: "Duración de llamadas al modelo",
  })
  const cache = meter.createCounter("agente.llm.tokens_cache", {
    unit: "{token}",
    description: "Tokens leídos/escritos en caché de prompt",
  })
  const turnos = meter.createCounter("agente.turnos", { description: "Turnos del agente por resultado" })
  const duracionTurno = meter.createHistogram("agente.turno.duracion", {
    unit: "ms",
    description: "Duración de un turno completo",
  })
  const iteraciones = meter.createHistogram("agente.turno.iteraciones", { description: "Llamadas al modelo por turno" })
  const llamadas = meter.createCounter("agente.herramienta.llamadas", { description: "Llamadas a herramientas" })
  const duracionHerramienta = meter.createHistogram("agente.herramienta.duracion", { unit: "ms" })
  const confirmaciones = meter.createCounter("agente.confirmaciones", { description: "Confirmaciones humanas por estado" })
  const errores = meter.createCounter("agente.errores", { description: "Errores por origen y clase" })
  const campos = meter.createCounter("agente.campos", { description: "Campos mapeados por estado" })
  const paquetes = meter.createCounter("agente.paquetes", { description: "Paquetes armados por estado de firma" })
  if (o.sesionesActivas) {
    const sesiones = o.sesionesActivas
    meter
      .createObservableGauge("agente.sesiones.activas", { description: "Sesiones en memoria" })
      .addCallback((r) => r.observe(sesiones()))
  }

  const base = (modelo: string): Attributes => ({ "gen_ai.provider.name": o.proveedor, "gen_ai.request.model": modelo })

  return {
    registrar(e) {
      switch (e.tipo) {
        case "llm":
          duracionLlm.record(e.duracionMs / 1000, { ...base(e.modelo), ...(e.ok ? {} : { "error.type": "llm_error" }) })
          if (!e.ok) return
          tokens.record(e.uso.entrada, { ...base(e.modelo), "gen_ai.token.type": "input" })
          tokens.record(e.uso.salida, { ...base(e.modelo), "gen_ai.token.type": "output" })
          cache.add(e.uso.cacheLectura, { ...base(e.modelo), tipo: "lectura" })
          cache.add(e.uso.cacheEscritura, { ...base(e.modelo), tipo: "escritura" })
          return
        case "turno":
          turnos.add(1, { resultado: e.resultado })
          duracionTurno.record(e.duracionMs, { resultado: e.resultado })
          iteraciones.record(e.iteraciones)
          return
        case "herramienta":
          llamadas.add(1, { "gen_ai.tool.name": e.nombre, ok: e.ok })
          duracionHerramienta.record(e.duracionMs, { "gen_ai.tool.name": e.nombre })
          return
        case "confirmacion":
          confirmaciones.add(1, { estado: e.estado })
          return
        case "error":
          errores.add(1, { origen: e.origen, clase: e.clase })
          return
        case "campos":
          campos.add(e.llenos, { estado: "lleno" })
          campos.add(e.faltantes, { estado: "faltante" })
          campos.add(e.porConfirmar, { estado: "requiere_confirmacion" })
          return
        case "paquete":
          paquetes.add(1, { listo_para_firma: e.listo })
          return
      }
    },
  }
}
