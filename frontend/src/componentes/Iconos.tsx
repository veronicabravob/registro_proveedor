import type { EstadoPunto, Tono } from "../dominio/pasos.ts"

const COLOR_PUNTO: Record<EstadoPunto, string> = { hecho: "#86EFAC", error: "#F97066", curso: "#111111", pendiente: "#E4E4E7" }
const POSICIONES = [
  [9.5, 20],
  [19, 10.5],
  [32, 6],
  [45, 10.5],
  [54.5, 20],
] as const

/** Los cinco puntos del logo de Periferia como indicador de avance del caso. */
export function PuntosProgreso({ puntos, etiqueta }: { puntos: readonly EstadoPunto[]; etiqueta: string }) {
  return (
    <svg width="60" height="26" viewBox="0 0 64 28" role="img" aria-label={etiqueta}>
      {POSICIONES.map(([cx, cy], i) => {
        const estado = puntos[i] ?? "pendiente"
        return (
          <circle
            key={cx}
            cx={cx}
            cy={cy}
            r={4.5}
            fill={COLOR_PUNTO[estado]}
            className={estado === "curso" ? "punto-salta" : undefined}
          />
        )
      })}
    </svg>
  )
}

export function PuntosMarca() {
  return <PuntosProgreso puntos={["hecho", "hecho", "hecho", "hecho", "hecho"]} etiqueta="" />
}

export function IconoTono({ tono }: { tono: Tono }) {
  if (tono === "error")
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="icono-paso">
        <circle cx="10" cy="10" r="10" fill="#FEE4E2" />
        <path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="#B42318" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  if (tono === "aviso")
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="icono-paso">
        <circle cx="10" cy="10" r="10" fill="#FEF0C7" />
        <path d="M10 5.5v5.5" stroke="#93370D" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="1.1" fill="#93370D" />
      </svg>
    )
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="icono-paso">
      <circle cx="10" cy="10" r="10" fill="#86EFAC" />
      <path
        d="M5.8 10.4l2.7 2.7 5.7-5.9"
        fill="none"
        stroke="#111111"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Girando() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="icono-paso gira">
      <circle cx="10" cy="10" r="8" fill="none" stroke="#E4E4E7" strokeWidth="2.2" />
      <path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="#111111" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function IconoArchivo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  )
}

export function IconoMas() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconoEnviar() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}
