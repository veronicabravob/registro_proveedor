import type { Llamada } from "../api/tipos.ts"
import { describirPaso, duracion, pasoEnCurso } from "../dominio/pasos.ts"
import { Girando, IconoTono } from "./Iconos.tsx"

/**
 * Pasos que ejecutó el agente. Cada paso se lee en lenguaje de negocio; el detalle técnico
 * (herramienta, lo que se le pidió y lo que respondió) queda disponible al desplegar (PRD §6.1).
 */
export function Pasos({ llamadas, enCurso }: { llamadas: readonly Llamada[]; enCurso?: string | null }) {
  if (!llamadas.length && !enCurso) return null
  return (
    <section className="pasos" aria-label={enCurso ? "Pasos que ejecuta el agente" : "Pasos que ejecutó el agente"}>
      {llamadas.map((l) => (
        <Paso key={l.id} llamada={l} />
      ))}
      {enCurso && <PasoEnCurso nombre={enCurso} />}
    </section>
  )
}

function Paso({ llamada }: { llamada: Llamada }) {
  const p = describirPaso(llamada)
  return (
    <details className="paso" open={p.tono === "error" ? true : undefined}>
      <summary>
        <IconoTono tono={p.tono} />
        <span className="paso-texto">
          <span className="paso-titulo">{p.titulo}</span> <span className="paso-detalle">{p.detalle}</span>
        </span>
        <span className="tecnico">
          {llamada.nombre} · {duracion(llamada.duracionMs)}
        </span>
      </summary>
      <div className="paso-cuerpo">
        <div className="tecnico-detalle">
          <div>
            <span className="rotulo">Lo que le pedí a la herramienta</span>
            <pre>{JSON.stringify(llamada.args, null, 2)}</pre>
          </div>
          <div>
            <span className="rotulo">Lo que respondió</span>
            <pre>{JSON.stringify({ ok: llamada.ok, resumen: llamada.resumen }, null, 2)}</pre>
          </div>
        </div>
      </div>
    </details>
  )
}

function PasoEnCurso({ nombre }: { nombre: string }) {
  const p = pasoEnCurso(nombre)
  return (
    <div className="paso paso-vivo" role="status">
      <Girando />
      <span className="paso-texto">
        <span className="paso-titulo">{p.titulo}</span> <span className="paso-detalle">{p.detalle}</span>
      </span>
      {nombre.startsWith("proveedor_") && <span className="tecnico">{nombre}</span>}
    </div>
  )
}
