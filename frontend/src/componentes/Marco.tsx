import { type FormEvent, useState } from "react"
import type { Salud, Uso } from "../api/tipos.ts"
import { type ConversacionGuardada, cuando } from "../dominio/conversaciones.ts"
import { IconoEnviar, IconoMas } from "./Iconos.tsx"

export function Encabezado({ salud }: { salud: Salud | null }) {
  return (
    <header className="encabezado">
      <img src="/logo-periferia.png" alt="Periferia IT Group" />
      <span className="producto">Registro de proveedores</span>
      <span className={`conexion${salud && !salud.llmConfigured ? " desconectado" : ""}`}>
        {salud ? (salud.llmConfigured ? "Asistente disponible" : "Asistente sin configurar") : "Conectando…"}
      </span>
    </header>
  )
}

export function Lateral(p: {
  conversaciones: readonly ConversacionGuardada[]
  actual: string | null
  uso: Uso | null
  salud: Salud | null
  nueva: () => void
  abrir: (id: string) => void
}) {
  const porcentaje = p.uso ? Math.min(100, Math.round(((p.uso.entrada + p.uso.salida) / p.uso.sessionLimit) * 100)) : null
  return (
    <nav className="lateral" aria-label="Historial de conversaciones">
      <h2>Conversaciones</h2>
      <button type="button" className="nueva" onClick={p.nueva}>
        <IconoMas />
        Nueva conversación
      </button>
      {p.conversaciones.map((c) => (
        <button
          key={c.id}
          type="button"
          className="item"
          aria-current={c.id === p.actual ? "true" : undefined}
          onClick={() => p.abrir(c.id)}
        >
          <span className="item-titulo">{c.titulo}</span>
          <span className="item-estado">
            {cuando(c.actualizada)} · {c.estado}
          </span>
        </button>
      ))}
      <div className="lateral-pie">
        {porcentaje !== null && <span>Uso de esta conversación: {porcentaje} % del tope</span>}
        {p.salud && (
          <span>
            Conectado a {p.salud.provider} · {p.salud.model}
          </span>
        )}
      </div>
    </nav>
  )
}

export function Compositor({
  enviar,
  trabajando,
  hayConversacion,
  archivada = false,
}: {
  enviar: (t: string) => void
  trabajando: boolean
  hayConversacion: boolean
  archivada?: boolean
}) {
  const [texto, setTexto] = useState("")
  const alEnviar = (e: FormEvent) => {
    e.preventDefault()
    if (!texto.trim() || trabajando) return
    enviar(texto)
    setTexto("")
  }
  const ayuda = trabajando
    ? "Dame un momento, ya casi termino"
    : archivada
      ? "Escribe para empezar una conversación nueva"
      : hayConversacion
        ? "Responde aquí o pide otra cosa"
        : "O escríbelo: procesa el caso ec-corp-andina"
  return (
    <form className="compositor" onSubmit={alEnviar}>
      <div className="caja">
        <label htmlFor="mensaje" className="oculto">
          Mensaje para el agente
        </label>
        <input
          id="mensaje"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={ayuda}
          disabled={trabajando}
          maxLength={4000}
          autoComplete="off"
        />
        <button type="submit" aria-label="Mandar mensaje al agente" disabled={trabajando || !texto.trim()}>
          <IconoEnviar />
        </button>
      </div>
    </form>
  )
}

export function ClaveAcceso({ ingresar }: { ingresar: (clave: string) => void }) {
  const [clave, setClave] = useState("")
  return (
    <div className="velo" role="dialog" aria-modal="true" aria-labelledby="titulo-clave">
      <form
        className="dialogo"
        onSubmit={(e) => {
          e.preventDefault()
          if (clave.trim()) ingresar(clave.trim())
        }}
      >
        <h2 id="titulo-clave">Clave de acceso</h2>
        <p>Este espacio está protegido. Escribe la clave que te compartieron.</p>
        <input
          type="password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" className="boton-primario">
          Entrar
        </button>
      </form>
    </div>
  )
}
