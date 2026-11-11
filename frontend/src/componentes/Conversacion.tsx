import { useEffect, useRef } from "react"
import type { AccionPendiente, Caso, Llamada } from "../api/tipos.ts"
import { archivosDelCaso, calcularProgreso, casoDe, nombreCorto, nombrePais, piden } from "../dominio/pasos.ts"
import type { Mensaje } from "../hooks/useAgente.ts"
import { Confirmacion } from "./Confirmacion.tsx"
import { PuntosProgreso } from "./Iconos.tsx"
import { Pasos } from "./Pasos.tsx"
import { Respuesta } from "./Respuesta.tsx"

interface Props {
  mensajes: readonly Mensaje[]
  casos: readonly Caso[]
  trabajando: boolean
  enVivo: readonly Llamada[]
  enCurso: string | null
  pendiente: AccionPendiente | null
  aviso: string | null
  cerrarAviso: () => void
  responder: (si: boolean) => void
}

export function Conversacion(p: Props) {
  const fin = useRef<HTMLDivElement>(null)
  const todas = [...p.mensajes.flatMap((m) => (m.tipo === "agente" ? m.llamadas : [])), ...p.enVivo]
  const caso = casoDe(todas)
  const datos = p.casos.find((c) => c.caso === caso)
  const cliente = datos?.cliente ? nombreCorto(datos.cliente) : null
  const progreso = calcularProgreso(todas, p.enCurso)

  // biome-ignore lint/correctness/useExhaustiveDependencies: estas props son los disparadores del desplazamiento al final
  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [p.mensajes.length, p.enVivo.length, p.enCurso, p.pendiente])

  return (
    <div className="conversacion">
      <div className="cabecera-caso">
        <div>
          <h1>{cliente ?? "Conversación"}</h1>
          {datos && (
            <span className="meta">
              {nombrePais(datos.pais)} · {piden(datos.formato)} · {datos.caso}
            </span>
          )}
        </div>
        {caso && (
          <div className="avance">
            <PuntosProgreso puntos={progreso.puntos} etiqueta={`Paso ${progreso.hechos} de 5: ${progreso.etiqueta}`} />
            <span>
              <strong>{progreso.hechos} de 5 pasos</strong>
              <br />
              {progreso.etiqueta}
            </span>
          </div>
        )}
      </div>

      {p.mensajes.map((m, i) =>
        m.tipo === "usuario" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: el historial solo crece al final
          <div key={i} className="burbuja-usuario">
            {m.texto}
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: el historial solo crece al final
          <div key={i} className="turno-agente">
            <Pasos llamadas={m.llamadas} />
            <Respuesta texto={m.texto} error={m.error} archivos={caso ? archivosDelCaso(caso, m.llamadas) : []} />
          </div>
        ),
      )}

      {p.trabajando && (
        <div className="turno-agente">
          <Pasos llamadas={p.enVivo} enCurso={p.enCurso ?? "pensando"} />
        </div>
      )}

      {p.aviso && (
        <div className="aviso" role="alert">
          <span>{p.aviso}</span>
          <button type="button" onClick={p.cerrarAviso} aria-label="Cerrar aviso">
            ×
          </button>
        </div>
      )}

      {p.pendiente && !p.trabajando && (
        <Confirmacion pendiente={p.pendiente} cliente={cliente} deshabilitada={p.trabajando} responder={p.responder} />
      )}
      <div ref={fin} />
    </div>
  )
}
