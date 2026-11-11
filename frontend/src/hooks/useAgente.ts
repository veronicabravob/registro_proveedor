import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api, ErrorApi, fijarClave } from "../api/cliente.ts"
import type { AccionPendiente, Caso, EntradaHistorial, Llamada, Salud, Uso } from "../api/tipos.ts"
import {
  actualizarConversacion,
  type ConversacionGuardada,
  estadoDe,
  guardarConversaciones,
  leerConversaciones,
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
}

const deHistorial = (m: EntradaHistorial): Mensaje =>
  m.rol === "usuario"
    ? { tipo: "usuario", texto: m.texto }
    : { tipo: "agente", texto: m.texto, llamadas: m.llamadas, pidioConfirmacion: m.needsConfirmation, error: m.error ?? null }

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
      setAviso(null)
      setPendiente(null)
      setTrabajando(true)
      setEnVivo([])
      setMensajes((m) => [...m, { tipo: "usuario", texto: limpio }])
      try {
        const r = await api.conversar(
          {
            ...(sesionId ? { sessionId: sesionId } : {}),
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
        setSesionId(r.sessionId)
        setMensajes((m) => [
          ...m,
          {
            tipo: "agente",
            texto: r.reply,
            llamadas: r.toolCalls,
            pidioConfirmacion: r.needsConfirmation,
            error: r.error?.mensaje ?? null,
          },
        ])
        setPendiente(r.needsConfirmation ? r.pendingAction : null)
        setUso(r.usage)
        if (r.error) setAviso(r.error.mensaje)

        const todas = [...mensajes.flatMap((m) => (m.tipo === "agente" ? m.llamadas : [])), ...r.toolCalls]
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
        setMensajes((m) => m.slice(0, -1))
        manejarError(e, () => void enviar(limpio, confirmar))
      } finally {
        setTrabajando(false)
        setEnCurso(null)
        setEnVivo([])
      }
    },
    [trabajando, sesionId, mensajes, clienteDe, manejarError],
  )

  const nueva = useCallback(() => {
    setSesionId(null)
    setMensajes([])
    setPendiente(null)
    setUso(null)
    setAviso(null)
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
      } catch (e) {
        if (e instanceof ErrorApi && e.estado === 404) {
          setConversaciones((l) => l.filter((c) => c.id !== id))
          setAviso("Esa conversación ya expiró en el servidor. Empieza una nueva.")
          nueva()
          return
        }
        manejarError(e, () => void abrir(id))
      }
    },
    [trabajando, manejarError, nueva],
  )

  const ingresarClave = useCallback((clave: string) => {
    fijarClave(clave)
    setPideClave(false)
    const repetir = reintento.current
    reintento.current = null
    repetir?.()
  }, [])

  const estado: EstadoAgente = useMemo(
    () => ({ salud, casos, conversaciones, sesionId, mensajes, trabajando, enVivo, enCurso, pendiente, uso, aviso, pideClave }),
    [salud, casos, conversaciones, sesionId, mensajes, trabajando, enVivo, enCurso, pendiente, uso, aviso, pideClave],
  )
  return { estado, enviar, nueva, abrir, ingresarClave, cerrarAviso: () => setAviso(null), clienteDe }
}
