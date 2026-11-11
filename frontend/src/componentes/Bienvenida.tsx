import type { Caso } from "../api/tipos.ts"
import { nombreCorto, nombreFormato, nombrePais } from "../dominio/pasos.ts"
import { PuntosMarca } from "./Iconos.tsx"

export function Bienvenida({
  casos,
  elegir,
  deshabilitada,
}: {
  casos: readonly Caso[]
  elegir: (c: Caso) => void
  deshabilitada: boolean
}) {
  return (
    <div className="bienvenida">
      <div className="bienvenida-intro">
        <PuntosMarca />
        <h1>Hola. ¿Qué registro preparamos hoy?</h1>
        <p>
          Leo el correo del cliente, lleno su formulario con los datos de Periferia y te dejo el paquete listo para firma.{" "}
          <strong>Firmar y enviar siempre lo decides tú.</strong>
        </p>
      </div>
      <div className="bandeja">
        <h2>Solicitudes en la bandeja · elige una para empezar</h2>
        <div className="tarjetas">
          {casos.map((c) => (
            <button key={c.caso} type="button" className="tarjeta" disabled={deshabilitada} onClick={() => elegir(c)}>
              <span className="tarjeta-pais">{nombrePais(c.pais)}</span>
              <span className="tarjeta-cliente">{c.cliente ? nombreCorto(c.cliente) : c.caso}</span>
              <span className="tarjeta-formato">{nombreFormato(c.formato)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
