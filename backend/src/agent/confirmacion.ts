import { normalizar } from "../tools/lib/texto.ts"

/**
 * Detección conservadora de una confirmación escrita (CA3, RN4). Solo cuenta si el mensaje es una
 * afirmación corta y explícita; cualquier negación o duda se trata como "no confirmado".
 * El front además envía `confirm: true|false` desde los botones, que tiene prioridad.
 */
const AFIRMACIONES = new Set([
  "si",
  "si confirmo",
  "confirmo",
  "confirmado",
  "si adelante",
  "adelante",
  "procede",
  "si procede",
  "si envia",
  "envia",
  "envialo",
  "si envialo",
  "de acuerdo",
  "ok",
  "ok envia",
  "dale",
  "aprobado",
  "apruebo",
])

const NEGACION = /\b(no|cancela|cancelar|espera|todavia|aun|despues|nunca)\b/

export function esConfirmacionExplicita(texto: string): boolean {
  const t = normalizar(texto)
  if (!t || t.length > 40 || NEGACION.test(t)) return false
  return AFIRMACIONES.has(t) || AFIRMACIONES.has(t.replace(/\b(por favor|gracias)\b/g, "").trim())
}
