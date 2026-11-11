import { z } from "zod"
import { type AdaptadorLlm, ErrorLlm, type Parte, type Respuesta, textoDe, type Uso, usoVacio } from "../llm/adapter.ts"
import { especificaciones, HERRAMIENTA_SOLICITAR_CONFIRMACION, REQUIEREN_CONFIRMACION } from "../tools/index.ts"
import { leerResultado, type Tool, type ToolContext } from "../tools/types.ts"
import type { BitacoraGlobal } from "./bitacora.ts"
import { esConfirmacionExplicita } from "./confirmacion.ts"
import type { Observador } from "./observador.ts"
import type { AccionPendiente, LlamadaVisible, PresupuestoDiario, Sesion } from "./sesiones.ts"

export interface DependenciasCiclo {
  llm: AdaptadorLlm
  herramientas: Readonly<Record<string, Tool>>
  sistema: string
  directorio: string
  limites: { iteraciones: number; tokensSesion: number }
  /** Tope global diario de tokens compartido por todas las sesiones (PRD §8). Opcional en pruebas. */
  presupuesto?: PresupuestoDiario
  fechaEjecucion?: string
  observador: Observador
  bitacora: BitacoraGlobal
}

export interface EntradaTurno {
  texto: string
  /** Respuesta de los botones del front ante una confirmación pendiente. Tiene prioridad sobre el texto. */
  confirmar?: boolean
  /** Avance en vivo del turno (para streaming al front). Opcional: el ciclo no depende de él. */
  alProgreso?: (e: Progreso) => void
}

/** Eventos de avance de un turno, en el orden en que ocurren. */
export type Progreso =
  | { tipo: "pensando"; iteracion: number }
  | { tipo: "paso_inicio"; id: string; nombre: string }
  | { tipo: "paso_fin"; llamada: LlamadaVisible }

export interface ResultadoTurno {
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  pendiente: AccionPendiente | null
  error?: { tipo: string; mensaje: string }
  iteraciones: number
  uso: Uso
}

/** Estado mutable de un turno: se descarta al terminar. */
interface Turno {
  progreso: (e: Progreso) => void
  sesion: Sesion
  confirmaciones: Set<string>
  llamadas: LlamadaVisible[]
  iteraciones: number
  needsConfirmation: boolean
  error?: { tipo: string; mensaje: string }
}

const sumarUso = (a: Uso, b: Uso): Uso => ({
  entrada: a.entrada + b.entrada,
  salida: a.salida + b.salida,
  cacheLectura: a.cacheLectura + b.cacheLectura,
  cacheEscritura: a.cacheEscritura + b.cacheEscritura,
})

/**
 * Ciclo del agente (PRD §6.3), estilo ReAct: modelo → herramientas → modelo… hasta una respuesta
 * final o un tope. Reglas: CA1 tope de iteraciones; CA2 valores solo de herramientas; CA3/RN4
 * confirmación humana validada por el host; CA4 bitácora de llamadas; CA5 errores en lenguaje claro.
 */
export async function ejecutarTurno(deps: DependenciasCiclo, sesion: Sesion, entrada: EntradaTurno): Promise<ResultadoTurno> {
  const inicio = Date.now()
  return deps.observador.envolver("turno", { sesionId: sesion.id, nombre: "agente.turno" }, async (tramo) => {
    tramo.entrada(entrada.texto)
    const turno: Turno = {
      progreso: entrada.alProgreso ?? (() => {}),
      sesion,
      confirmaciones: new Set(),
      llamadas: [],
      iteraciones: 0,
      needsConfirmation: false,
    }
    const nota = resolverConfirmacion(deps, turno, entrada)
    sesion.mensajes.push({ rol: "usuario", partes: [{ tipo: "texto", texto: entrada.texto }, ...(nota ? [nota] : [])] })

    const { reply, resultado } = await iterar(deps, turno)
    tramo.salida(reply)
    tramo.atributos({ iteraciones: turno.iteraciones, needsConfirmation: turno.needsConfirmation, resultado })
    if (turno.error) tramo.error(turno.error.mensaje)
    deps.observador.evento({ tipo: "turno", resultado, iteraciones: turno.iteraciones, duracionMs: Date.now() - inicio })

    return {
      reply,
      toolCalls: turno.llamadas,
      needsConfirmation: turno.needsConfirmation,
      pendiente: sesion.pendiente,
      ...(turno.error ? { error: turno.error } : {}),
      iteraciones: turno.iteraciones,
      uso: sesion.uso,
    }
  })
}

/**
 * La confirmación pendiente solo vale para el mensaje inmediatamente siguiente (RN4): se consume
 * siempre. Si el usuario confirma, el host registra `accion:caso` en las confirmaciones del turno.
 */
function resolverConfirmacion(deps: DependenciasCiclo, turno: Turno, entrada: EntradaTurno): Parte | null {
  const pendiente = turno.sesion.pendiente
  turno.sesion.pendiente = null
  if (!pendiente) return null
  const aprobada = entrada.confirmar ?? esConfirmacionExplicita(entrada.texto)
  deps.observador.evento({ tipo: "confirmacion", estado: aprobada ? "aprobada" : "rechazada" })
  if (aprobada) turno.confirmaciones.add(`${pendiente.accion}:${pendiente.caso}`)
  const texto = aprobada
    ? `[Nota del sistema] El usuario CONFIRMÓ explícitamente la acción ${pendiente.accion} del caso ${pendiente.caso}. Puedes ejecutarla ahora.`
    : `[Nota del sistema] El usuario NO confirmó la acción ${pendiente.accion} del caso ${pendiente.caso}. No la ejecutes.`
  return { tipo: "texto", texto }
}

type Resultado = "ok" | "error" | "tope_iteraciones" | "tope_tokens" | "rechazo"

async function iterar(deps: DependenciasCiclo, turno: Turno): Promise<{ reply: string; resultado: Resultado }> {
  const herramientas = especificaciones(deps.herramientas)
  while (turno.iteraciones < deps.limites.iteraciones) {
    if (turno.sesion.uso.entrada + turno.sesion.uso.salida >= deps.limites.tokensSesion) {
      return { reply: mensajeTope(turno, "tokens", deps.limites.tokensSesion), resultado: "tope_tokens" }
    }
    if (deps.presupuesto?.agotado()) {
      return { reply: mensajeTope(turno, "diario", deps.presupuesto.limite), resultado: "tope_tokens" }
    }
    turno.iteraciones++
    turno.progreso({ tipo: "pensando", iteracion: turno.iteraciones })
    const respuesta = await llamarModelo(deps, turno, herramientas)
    if (!respuesta) return { reply: turno.error?.mensaje ?? "Error al consultar el modelo.", resultado: "error" }

    if (respuesta.motivo === "rechazo") {
      // Un rechazo puede cortar una llamada a medias: no se ejecuta ni se guarda en el historial.
      return {
        reply: "El modelo no puede ayudar con esta solicitud. Reformúlala o inicia una sesión nueva.",
        resultado: "rechazo",
      }
    }
    const llamadas = respuesta.mensaje.partes.filter((p): p is Extract<Parte, { tipo: "llamada" }> => p.tipo === "llamada")
    if (llamadas.length === 0) {
      turno.sesion.mensajes.push(respuesta.mensaje)
      return { reply: textoDe(respuesta.mensaje) || "(sin respuesta)", resultado: "ok" }
    }
    const resultados =
      respuesta.motivo === "max_tokens"
        ? llamadas.map((l) =>
            resultadoError(l.id, "La llamada quedó truncada (max_tokens). Reintenta con argumentos más cortos."),
          )
        : await ejecutarLlamadas(deps, turno, llamadas)
    // Llamadas y resultados se agregan juntos: el historial nunca queda con un tool_use sin respuesta.
    turno.sesion.mensajes.push(respuesta.mensaje, { rol: "usuario", partes: resultados })
  }
  return { reply: mensajeTope(turno, "iteraciones", deps.limites.iteraciones), resultado: "tope_iteraciones" }
}

async function llamarModelo(
  deps: DependenciasCiclo,
  turno: Turno,
  herramientas: ReturnType<typeof especificaciones>,
): Promise<Respuesta | null> {
  const inicio = Date.now()
  try {
    const r = await deps.llm.enviar({
      sistema: deps.sistema,
      mensajes: turno.sesion.mensajes,
      herramientas,
      sesionId: turno.sesion.id,
    })
    turno.sesion.uso = sumarUso(turno.sesion.uso, r.uso)
    deps.presupuesto?.registrar(r.uso.entrada + r.uso.salida)
    deps.observador.evento({ tipo: "llm", modelo: r.modelo, uso: r.uso, duracionMs: Date.now() - inicio, ok: true })
    return r
  } catch (e) {
    const error = e instanceof ErrorLlm ? e : new ErrorLlm("proveedor", "Error inesperado al consultar el modelo.", false)
    turno.error = { tipo: error.tipo, mensaje: error.message }
    deps.observador.evento({ tipo: "llm", modelo: deps.llm.modelo, uso: usoVacio(), duracionMs: Date.now() - inicio, ok: false })
    deps.observador.evento({ tipo: "error", origen: "llm", clase: error.tipo })
    return null
  }
}

function resultadoError(llamadaId: string, mensaje: string): Parte {
  return { tipo: "resultado", llamadaId, contenido: JSON.stringify({ ok: false, error: mensaje }), esError: true }
}

async function ejecutarLlamadas(
  deps: DependenciasCiclo,
  turno: Turno,
  llamadas: readonly Extract<Parte, { tipo: "llamada" }>[],
): Promise<Parte[]> {
  const resultados: Parte[] = []
  // Secuencial: el orden de efectos en out/ es determinista y la bitácora queda ordenada.
  for (const llamada of llamadas) resultados.push(await ejecutarLlamada(deps, turno, llamada))
  return resultados
}

async function ejecutarLlamada(
  deps: DependenciasCiclo,
  turno: Turno,
  llamada: Extract<Parte, { tipo: "llamada" }>,
): Promise<Parte> {
  return deps.observador.envolver("herramienta", { sesionId: turno.sesion.id, nombre: llamada.nombre }, async (tramo) => {
    const inicio = Date.now()
    turno.progreso({ tipo: "paso_inicio", id: llamada.id, nombre: llamada.nombre })
    tramo.entrada(llamada.args)
    const salida = await invocar(deps, turno, llamada)
    const r = leerResultado(salida)
    const resumen = r.ok ? String(r.data.resumen ?? "ok") : r.error
    const duracionMs = Date.now() - inicio

    tramo.salida(resumen)
    if (!r.ok) tramo.error(r.error)
    registrarLlamada(deps, turno, { id: llamada.id, nombre: llamada.nombre, args: llamada.args, ok: r.ok, resumen, duracionMs })
    if (r.ok) efectosDeResultado(deps, turno, llamada.nombre, r.data)
    return { tipo: "resultado", llamadaId: llamada.id, contenido: salida, esError: !r.ok }
  })
}

/** Valida argumentos y aplica la puerta de confirmación antes de ejecutar. Nunca lanza. */
async function invocar(deps: DependenciasCiclo, turno: Turno, llamada: Extract<Parte, { tipo: "llamada" }>): Promise<string> {
  const tool = deps.herramientas[llamada.nombre]
  if (!tool) return JSON.stringify({ ok: false, error: `Herramienta desconocida: ${llamada.nombre}` })

  const args = z.object(tool.args).strict().safeParse(llamada.args)
  if (!args.success) {
    const detalle = args.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ")
    return JSON.stringify({ ok: false, error: `Argumentos inválidos: ${detalle}` })
  }

  const accion = REQUIEREN_CONFIRMACION[llamada.nombre]
  const caso = (args.data as { caso?: unknown }).caso
  if (accion && !turno.confirmaciones.has(`${accion}:${String(caso)}`)) {
    deps.observador.evento({ tipo: "confirmacion", estado: "bloqueada" })
    return JSON.stringify({ ok: false, error: "requiere confirmación explícita" })
  }

  const ctx: ToolContext = {
    directory: deps.directorio,
    sessionId: turno.sesion.id,
    confirmaciones: turno.confirmaciones,
    ...(deps.fechaEjecucion ? { fechaEjecucion: deps.fechaEjecucion } : {}),
  }
  try {
    return await tool.execute(args.data, ctx)
  } catch {
    deps.observador.evento({ tipo: "error", origen: "herramienta", clase: llamada.nombre })
    return JSON.stringify({ ok: false, error: `La herramienta ${llamada.nombre} falló de forma inesperada` })
  }
}

function registrarLlamada(deps: DependenciasCiclo, turno: Turno, l: LlamadaVisible): void {
  turno.llamadas.push(l)
  turno.progreso({ tipo: "paso_fin", llamada: l })
  deps.bitacora.registrar({
    sessionId: turno.sesion.id,
    herramienta: l.nombre,
    ok: l.ok,
    resumen: l.resumen,
    duracionMs: l.duracionMs,
    args: l.args,
  })
  deps.observador.evento({ tipo: "herramienta", nombre: l.nombre, ok: l.ok, duracionMs: l.duracionMs })
}

const largo = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

/** Efectos de estado y métricas de negocio derivados de resultados exitosos. */
function efectosDeResultado(deps: DependenciasCiclo, turno: Turno, nombre: string, data: Record<string, unknown>): void {
  if (nombre === HERRAMIENTA_SOLICITAR_CONFIRMACION) {
    turno.sesion.pendiente = { accion: String(data.accion), caso: String(data.caso), detalle: String(data.detalle ?? "") }
    turno.needsConfirmation = true
    deps.observador.evento({ tipo: "confirmacion", estado: "solicitada" })
  } else if (nombre === "proveedor_mapear_campos") {
    deps.observador.evento({
      tipo: "campos",
      llenos: largo(data.llenos),
      faltantes: largo(data.faltantes),
      porConfirmar: largo(data.requiere_confirmacion),
    })
  } else if (nombre === "proveedor_armar_paquete") {
    deps.observador.evento({ tipo: "paquete", listo: data.listo_para_firma === true })
  }
}

/** CA1: al llegar a un tope, responde con lo que tiene y lo que falta (sin otra llamada al modelo). */
const MOTIVOS_TOPE: Record<"iteraciones" | "tokens" | "diario", (limite: string) => string> = {
  iteraciones: (l) => `Alcancé el tope de ${l} pasos para este turno.`,
  tokens: (l) => `Esta sesión alcanzó su tope de ${l} tokens. Inicia una sesión nueva para continuar.`,
  diario: (l) =>
    `El servicio alcanzó su tope diario de uso del modelo (${l} tokens entre todas las sesiones). ` +
    "Intenta de nuevo mañana: el contador se reinicia a las 00:00 UTC. Tu sesión sigue activa.",
}

function mensajeTope(turno: Turno, tope: "iteraciones" | "tokens" | "diario", limite: number): string {
  const hechas = turno.llamadas.map((l) => `- ${l.ok ? "✔" : "✘"} ${l.nombre}: ${l.resumen}`)
  const motivo = MOTIVOS_TOPE[tope](tope === "iteraciones" ? String(limite) : limite.toLocaleString("es-CO"))
  return [
    `**${motivo}**`,
    "",
    hechas.length ? "Lo que alcancé a hacer:" : "No alcancé a ejecutar herramientas.",
    ...hechas,
    "",
    tope === "iteraciones" ? "Escribe «continúa» para seguir desde aquí." : "",
  ]
    .join("\n")
    .trim()
}
