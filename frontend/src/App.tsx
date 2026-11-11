import { Bienvenida } from "./componentes/Bienvenida.tsx"
import { Conversacion } from "./componentes/Conversacion.tsx"
import { ClaveAcceso, Compositor, Encabezado, Lateral } from "./componentes/Marco.tsx"
import { useAgente } from "./hooks/useAgente.ts"

const PEDIDO_CASO = (caso: string) =>
  `Procesa el caso "${caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`

export function App() {
  const { estado: e, enviar, nueva, abrir, ingresarClave, cerrarAviso } = useAgente()
  const enConversacion = e.mensajes.length > 0 || e.trabajando

  return (
    <div className="app">
      <Encabezado salud={e.salud} />
      <div className="cuerpo">
        <Lateral
          conversaciones={e.conversaciones}
          actual={e.sesionId}
          uso={e.uso}
          salud={e.salud}
          nueva={nueva}
          abrir={(id) => void abrir(id)}
        />
        <main className="principal">
          <div className={`lienzo${enConversacion ? "" : " lienzo-inicio"}`}>
            {enConversacion ? (
              <Conversacion
                mensajes={e.mensajes}
                casos={e.casos}
                trabajando={e.trabajando}
                enVivo={e.enVivo}
                enCurso={e.enCurso}
                pendiente={e.pendiente}
                aviso={e.aviso}
                cerrarAviso={cerrarAviso}
                responder={(si) => void enviar(si ? "Sí, confirmo el envío." : "No, todavía no.", si)}
              />
            ) : (
              <>
                <Bienvenida casos={e.casos} deshabilitada={e.trabajando} elegir={(c) => void enviar(PEDIDO_CASO(c.caso))} />
                {e.aviso && (
                  <div className="aviso" role="alert">
                    <span>{e.aviso}</span>
                    <button type="button" onClick={cerrarAviso} aria-label="Cerrar aviso">
                      ×
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <Compositor
            enviar={(t) => void enviar(t)}
            trabajando={e.trabajando}
            hayConversacion={enConversacion}
            archivada={e.archivada}
          />
        </main>
      </div>
      {e.pideClave && <ClaveAcceso ingresar={ingresarClave} />}
    </div>
  )
}
