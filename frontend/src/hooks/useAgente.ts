import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api, ErrorApi, fijarClave } from "../api/cliente.ts"
import type { AccionPendiente, Caso, EntradaHistorial, Llamada, Salud, Uso } from "../api/tipos.ts"
import {
  actualizarConversacion,
  type ConversacionGuardada,
  estadoDe,
  guardarConversaciones,
  guardarHistorial,
  leerConversaciones,
  leerHistorial,
} from "../dominio/conversaciones.ts"
import { casoDe, nombreCorto } from "../dominio/pasos.ts"

export type Mensaje =
  | { tipo: "usuario"; texto: string }
  | { tipo: "agente"; texto: string; llamadas: Llamada[]; pidioConfirmacion: boolean; error: string | null }

export interface EstadoAgente {
  salud: Salud | null
  casos: Caso[]
  conversaciones: ConversacionGuardada[]
  sesionId: string | null
  mensajes: Mensaje[]
  trabajando: boolean
  enVivo: Llamada[]
  enCurso: string | null
  pendiente: AccionPendiente | null
  uso: Uso | null
  aviso: string | null
  pideClave: boolean
  /** Conversación antigua que el servidor ya no tiene: se puede leer, no continuar. */
  archivada: boolean
}

const deHistorial = (m: EntradaHistorial): Mensaje =>
  m.rol === "usuario"
    ? { tipo: "usuario", texto: m.texto }
    : { tipo: "agente", texto: m.texto, llamadas: m.llamadas, pidioConfirmacion: m.needsConfirmation, error: m.error ?? null }

const AVISO_ARCHIVADA =
  "Esta conversación ya terminó en el servidor (se reinicia con cada actualización): puedes leerla aquí; si escribes, empieza una nueva."
const AVISO_SIN_COPIA =
  "Esta conversación ya terminó en el servidor y este navegador no tiene una copia. Escribe para empezar una nueva."

/** Estado y acciones del chat con el agente. Toda la comunicación con el backend pasa por aquí. */
export function useAgente() {
  const [salud, setSalud] = useState<Salud | null>(null)
  const [casos, setCasos] = useState<Caso[]>([])
  const [conversaciones, setConversaciones] = useState<ConversacionGuardada[]>(leerConversaciones)
  const [sesionId, setSesionId] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const [enVivo, setEnVivo] = useState<Llamada[]>([])
  const [enCurso, setEnCurso] = useState<string | null>(null)
  const [pendiente, setPendiente] = useState<AccionPendiente | null>(null)
  const [uso, setUso] = useState<Uso | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pideClave, setPideClave] = useState(false)
  const [archivada, setArchivada] = useState(false)
  const reintento = useRef<(() => void) | null>(null)

  const manejarError = useCallback((e: unknown, repetir?: () => void) => {
    if (e instanceof ErrorApi && e.estado === 401) {
      reintento.current = repetir ?? null
      setPideClave(true)
      return
    }
    setAviso(e instanceof Error ? e.message : "Algo salió mal. Intenta de nuevo.")
  }, [])

  const cargarCasos = useCallback(() => {
    api.casos().then(setCasos, (e: unknown) => manejarError(e, cargarCasos))
  }, [manejarError])

  useEffect(() => {
    api.salud().then(setSalud, () => setAviso("No hay conexión con el servidor."))
    cargarCasos()
  }, [cargarCasos])

  useEffect(() => guardarConversaciones(conversaciones), [conversaciones])

  const clienteDe = useCallback(
    (caso: string | null) => {
      const c = casos.find((x) => x.caso === caso)
      return c?.cliente ? nombreCorto(c.cliente) : null
    },
    [casos],
  )

  const enviar = useCallback(
    async (texto: string, confirmar?: boolean) => {
      const limpio = texto.trim()
      if (!limpio || trabajando) return
      // Escribir sobre una conversación archivada empieza una nueva (el servidor ya no la tiene).
      const base = archivada ? [] : mensajes
      const sesionBase = archivada ? null : sesionId
      const usuario: Mensaje = { tipo: "usuario", texto: limpio }
      setArchivada(false)
      setAviso(null)
      setPendiente(null)
      setTrabajando(true)
      setEnVivo([])
      if (archivada) {
        setSesionId(null)
        setUso(null)
      }
      setMensajes([...base, usuario])
      try {
        const r = await api.conversar(
          {
            ...(sesionBase ? { sessionId: sesionBase } : {}),
            message: limpio,
            ...(confirmar === undefined ? {} : { confirm: confirmar }),
          },
          (e) => {
            if (e.tipo === "paso_inicio") setEnCurso(e.nombre)
            if (e.tipo === "paso_fin") {
              setEnCurso(null)
              setEnVivo((v) => [...v, e.llamada])
            }
          },
        )
        const respuesta: Mensaje = {
          tipo: "agente",
          texto: r.reply,
          llamadas: r.toolCalls,
          pidioConfirmacion: r.needsConfirmation,
          error: r.error?.mensaje ?? null,
        }
        const historial = [...base, usuario, respuesta]
        setSesionId(r.sessionId)
        setMensajes(historial)
        guardarHistorial(r.sessionId, historial)
        setPendiente(r.needsConfirmation ? r.pendingAction : null)
        setUso(r.usage)
        if (r.error) setAviso(r.error.mensaje)

        const todas = historial.flatMap((m) => (m.tipo === "agente" ? m.llamadas : []))
        const caso = casoDe(todas)
        setConversaciones((lista) =>
          actualizarConversacion(lista, {
            id: r.sessionId,
            titulo: clienteDe(caso) ?? lista.find((c) => c.id === r.sessionId)?.titulo ?? limpio.slice(0, 40),
            caso,
            estado: estadoDe(r, r.toolCalls.length ? r.toolCalls : todas),
            actualizada: new Date().toISOString(),
          }),
        )
      } catch (e) {
        setMensajes(base)
        manejarError(e, () => void enviar(limpio, confirmar))
      } finally {
        setTrabajando(false)
        setEnCurso(null)
        setEnVivo([])
      }
    },
    [trabajando, sesionId, mensajes, archivada, clienteDe, manejarError],
  )

  const nueva = useCallback(() => {
    setSesionId(null)
    setMensajes([])
    setPendiente(null)
    setUso(null)
    setAviso(null)
    setArchivada(false)
  }, [])

  const abrir = useCallback(
    async (id: string) => {
      if (trabajando) return
      try {
        const s = await api.sesion(id)
        setSesionId(s.sessionId)
        setMensajes(s.messages.map(deHistorial))
        setPendiente(s.pendingAction)
        setUso(s.usage)
        setAviso(null)
        setArchivada(false)
      } catch (e) {
        if (!(e instanceof ErrorApi && e.estado === 404)) {
          manejarError(e, () => void abrir(id))
          return
        }
        // El servidor ya no tiene la sesión: se muestra la copia local y la conversación se conserva.
        const copia = leerHistorial<Mensaje>(id)
        setSesionId(id)
        setMensajes(copia ?? [])
        setPendiente(null)
        setUso(null)
        setArchivada(true)
        setAviso(copia ? AVISO_ARCHIVADA : AVISO_SIN_COPIA)
        setConversaciones((l) => l.map((c) => (c.id === id ? { ...c, estado: "solo lectura" } : c)))
      }
    },
    [trabajando, manejarError],
  )

  const ingresarClave = useCallback((clave: string) => {
    fijarClave(clave)
    setPideClave(false)
    const repetir = reintento.current
    reintento.current = null
    repetir?.()
  }, [])

  const estado: EstadoAgente = useMemo(
    () => ({
      salud,
      casos,
      conversaciones,
      sesionId,
      mensajes,
      trabajando,
      enVivo,
      enCurso,
      pendiente,
      uso,
      aviso,
      pideClave,
      archivada,
    }),
    [salud, casos, conversaciones, sesionId, mensajes, trabajando, enVivo, enCurso, pendiente, uso, aviso, pideClave, archivada],
  )
  return { estado, enviar, nueva, abrir, ingresarClave, cerrarAviso: () => setAviso(null), clienteDe }
}
