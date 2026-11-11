import Anthropic from "@anthropic-ai/sdk"
import type { AdaptadorLlm, Mensaje, MotivoFin, Parte, PeticionLlm, Respuesta } from "./adapter.ts"
import { ErrorLlm } from "./adapter.ts"

type Bloque = Anthropic.Beta.BetaContentBlock
type BloqueParam = Anthropic.Beta.BetaContentBlockParam
type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max"

export interface OpcionesAnthropic {
  apiKey: string
  modelo: string
  maxTokens: number
  esfuerzo: Esfuerzo
  timeoutMs: number
  /** Fallback del servidor ante rechazos de los clasificadores de seguridad (modelos 5.x). */
  fallbacks: boolean
  /** Si los spans del SDK incluyen prompts y respuestas (`content`) o solo metadatos. */
  contenidoTrazas: "metadata_only" | "content"
}

const PROVEEDOR = "anthropic"

/**
 * Implementación del adaptador para Claude (Messages API).
 * - Prompt caching del system prompt + herramientas (prefijo estable).
 * - Reenvía el contenido nativo (bloques de razonamiento) sin modificarlo.
 * - Errores tipados del SDK → ErrorLlm con mensaje claro.
 * - El SDK emite spans OpenTelemetry por sí mismo (anthropic.messages.create).
 */
export class AdaptadorAnthropic implements AdaptadorLlm {
  readonly proveedor = PROVEEDOR
  readonly modelo: string
  private readonly cliente: Anthropic

  constructor(private readonly opciones: OpcionesAnthropic) {
    this.modelo = opciones.modelo
    this.cliente = new Anthropic({
      apiKey: opciones.apiKey,
      timeout: opciones.timeoutMs,
      maxRetries: 2,
      openTelemetry: { traces: { contentMode: opciones.contenidoTrazas } },
    })
  }

  async enviar(p: PeticionLlm): Promise<Respuesta> {
    const herramientas: Anthropic.Beta.BetaTool[] = p.herramientas.map((h) => ({
      name: h.name,
      description: h.description,
      input_schema: h.parameters as Anthropic.Beta.BetaTool.InputSchema,
    }))
    const ultima = herramientas.at(-1)
    if (ultima) ultima.cache_control = { type: "ephemeral" }

    try {
      const respuesta = await this.cliente.beta.messages.create(
        {
          model: this.opciones.modelo,
          max_tokens: this.opciones.maxTokens,
          system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
          tools: herramientas,
          messages: p.mensajes.map(aParam),
          output_config: { effort: this.opciones.esfuerzo },
          ...(this.opciones.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: p.senal, openTelemetry: { conversationId: p.sesionId } },
      )
      return deRespuesta(respuesta)
    } catch (e) {
      throw normalizarError(e)
    }
  }
}

function aParam(m: Mensaje): Anthropic.Beta.BetaMessageParam {
  if (m.rol === "asistente" && m.nativo?.proveedor === PROVEEDOR && Array.isArray(m.nativo.contenido)) {
    return { role: "assistant", content: m.nativo.contenido as Bloque[] }
  }
  return { role: m.rol === "usuario" ? "user" : "assistant", content: m.partes.map(aBloque) }
}

function aBloque(p: Parte): BloqueParam {
  if (p.tipo === "texto") return { type: "text", text: p.texto }
  if (p.tipo === "llamada") return { type: "tool_use", id: p.id, name: p.nombre, input: p.args }
  return { type: "tool_result", tool_use_id: p.llamadaId, content: p.contenido, is_error: p.esError }
}

function motivo(stop: Anthropic.Beta.BetaStopReason | null): MotivoFin {
  switch (stop) {
    case "end_turn":
    case "stop_sequence":
      return "fin_turno"
    case "tool_use":
      return "herramientas"
    case "max_tokens":
      return "max_tokens"
    case "refusal":
      return "rechazo"
    default:
      return "otro"
  }
}

function deRespuesta(r: Anthropic.Beta.BetaMessage): Respuesta {
  const partes: Parte[] = []
  for (const b of r.content) {
    if (b.type === "text") partes.push({ tipo: "texto", texto: b.text })
    else if (b.type === "tool_use") partes.push({ tipo: "llamada", id: b.id, nombre: b.name, args: b.input })
  }
  const u = r.usage
  return {
    mensaje: { rol: "asistente", partes, nativo: { proveedor: PROVEEDOR, contenido: r.content } },
    motivo: motivo(r.stop_reason),
    modelo: r.model,
    uso: {
      entrada: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      salida: u.output_tokens,
      cacheLectura: u.cache_read_input_tokens ?? 0,
      cacheEscritura: u.cache_creation_input_tokens ?? 0,
    },
  }
}

/** De más específico a menos específico (errores tipados del SDK, nunca por texto). */
function normalizarError(e: unknown): ErrorLlm {
  if (e instanceof ErrorLlm) return e
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new ErrorLlm("timeout", "El modelo tardó demasiado en responder. Intenta de nuevo en un momento.", true)
  }
  if (e instanceof Anthropic.APIUserAbortError) return new ErrorLlm("timeout", "La solicitud al modelo fue cancelada.", true)
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ErrorLlm(
      "autenticacion",
      "El servidor no pudo autenticarse con el proveedor del modelo. Revisa la configuración.",
      false,
    )
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ErrorLlm(
      "limite",
      "El proveedor del modelo está limitando las solicitudes. Espera unos segundos e intenta de nuevo.",
      true,
    )
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new ErrorLlm("solicitud", "El proveedor rechazó la solicitud. Inicia una sesión nueva si el problema persiste.", false)
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ErrorLlm("red", "No hay conexión con el proveedor del modelo. Intenta de nuevo.", true)
  }
  if (e instanceof Anthropic.APIError) {
    return new ErrorLlm("proveedor", "El proveedor del modelo tuvo un error temporal. Intenta de nuevo.", true)
  }
  return new ErrorLlm("proveedor", "Error inesperado al consultar el modelo.", false)
}
