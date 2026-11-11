import type { AccionPendiente } from "../api/tipos.ts"
import { sinRutas } from "../dominio/pasos.ts"

/**
 * Confirmación humana resaltada (CA3/RN4). El backend solo ejecuta la acción si la respuesta llega
 * en el mensaje inmediatamente siguiente; estos botones envían esa respuesta explícita.
 */
export function Confirmacion({
  pendiente,
  cliente,
  deshabilitada,
  responder,
}: {
  pendiente: AccionPendiente
  cliente: string | null
  deshabilitada: boolean
  responder: (si: boolean) => void
}) {
  const quien = cliente ?? pendiente.caso
  return (
    <section className="confirmacion" aria-label="Confirmación requerida" aria-live="polite">
      <span className="confirmacion-sello">
        <span className="punto-verde" aria-hidden="true" />
        Necesito tu respuesta para seguir
      </span>
      <p className="confirmacion-pregunta">¿Registro el envío del paquete de {quien}?</p>
      <p className="confirmacion-nota">Aquí el envío es simulado: solo se escribe un archivo, no sale ningún correo.</p>
      {pendiente.detalle && <p className="confirmacion-detalle">{sinRutas(pendiente.detalle)}</p>}
      <div className="confirmacion-botones">
        <button type="button" className="boton-primario" disabled={deshabilitada} onClick={() => responder(true)}>
          Sí, regístralo
        </button>
        <button type="button" className="boton-secundario" disabled={deshabilitada} onClick={() => responder(false)}>
          No, lo reviso yo
        </button>
      </div>
    </section>
  )
}
