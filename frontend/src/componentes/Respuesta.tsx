import { useState } from "react"
import Markdown from "react-markdown"
import { api } from "../api/cliente.ts"
import { nombreArchivo } from "../dominio/pasos.ts"
import { IconoArchivo } from "./Iconos.tsx"

/** Respuesta del agente. react-markdown no interpreta HTML crudo: el texto del modelo no puede inyectar marcado. */
export function Respuesta({ texto, archivos, error }: { texto: string; archivos: readonly string[]; error: string | null }) {
  return (
    <article className={`respuesta${error ? " respuesta-error" : ""}`}>
      <Markdown
        components={{
          // Las rutas de archivo se ofrecen como descargas: en el texto se muestran solo por su nombre.
          code: ({ children }) => <code>{String(children).startsWith("out/") ? nombreArchivo(String(children)) : children}</code>,
        }}
      >
        {texto}
      </Markdown>
      {archivos.length > 0 && <Archivos rutas={archivos} />}
    </article>
  )
}

export function Archivos({ rutas }: { rutas: readonly string[] }) {
  const [fallo, setFallo] = useState<string | null>(null)
  return (
    <div className="archivos">
      {rutas.map((r) => (
        <button
          key={r}
          type="button"
          className="archivo"
          title={`Descargar ${nombreArchivo(r)}`}
          onClick={() =>
            api.descargar(r).then(
              () => setFallo(null),
              () => setFallo(nombreArchivo(r)),
            )
          }
        >
          <IconoArchivo />
          {nombreArchivo(r)}
        </button>
      ))}
      {fallo && <span className="archivo-fallo">No pude descargar {fallo}. Vuelve a procesar el caso.</span>}
    </div>
  )
}
