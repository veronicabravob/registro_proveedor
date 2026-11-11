import { type DependenciasCiclo, type EntradaTurno, ejecutarTurno, type ResultadoTurno } from "./ciclo.ts"
import type { AlmacenSesiones, Sesion } from "./sesiones.ts"

export type ResultadoConversacion =
  | { tipo: "ok"; sesion: Sesion; resultado: ResultadoTurno }
  | { tipo: "ocupada"; sesion: Sesion }

/**
 * Caso de uso "conversar": obtiene o crea la sesión, evita turnos concurrentes en la misma sesión,
 * ejecuta el turno y actualiza el historial visible. Un error inesperado nunca mata la sesión (CA5).
 */
export async function conversar(
  deps: DependenciasCiclo,
  almacen: AlmacenSesiones,
  peticion: { sessionId?: string | undefined } & EntradaTurno,
): Promise<ResultadoConversacion> {
  const sesion = (peticion.sessionId && almacen.obtener(peticion.sessionId)) || almacen.crear(peticion.sessionId)
  if (sesion.ocupada) return { tipo: "ocupada", sesion }

  sesion.ocupada = true
  sesion.transcripcion.push({ rol: "usuario", texto: peticion.texto, ts: new Date().toISOString() })
  try {
    const entrada: EntradaTurno = {
      texto: peticion.texto,
      ...(peticion.confirmar === undefined ? {} : { confirmar: peticion.confirmar }),
      ...(peticion.alProgreso ? { alProgreso: peticion.alProgreso } : {}),
    }
    const resultado = await ejecutarTurno(deps, sesion, entrada)
    registrarRespuesta(sesion, resultado)
    return { tipo: "ok", sesion, resultado }
  } catch {
    deps.observador.evento({ tipo: "error", origen: "interno", clase: "turno" })
    const resultado: ResultadoTurno = {
      reply: "Ocurrió un error inesperado procesando tu mensaje. La sesión sigue activa: intenta de nuevo.",
      toolCalls: [],
      needsConfirmation: false,
      pendiente: null,
      error: { tipo: "interno", mensaje: "Error inesperado" },
      iteraciones: 0,
      uso: sesion.uso,
    }
    registrarRespuesta(sesion, resultado)
    return { tipo: "ok", sesion, resultado }
  } finally {
    sesion.ocupada = false
    sesion.actualizada = Date.now()
  }
}

function registrarRespuesta(sesion: Sesion, r: ResultadoTurno): void {
  sesion.transcripcion.push({
    rol: "asistente",
    texto: r.reply,
    ts: new Date().toISOString(),
    llamadas: r.toolCalls,
    needsConfirmation: r.needsConfirmation,
    ...(r.error ? { error: r.error.mensaje } : {}),
  })
}
