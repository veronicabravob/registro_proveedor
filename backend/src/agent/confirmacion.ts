import { normalizar } from "../tools/lib/texto.ts"

/**
 * Detección conservadora de una confirmación escrita (CA3, RN4). Cuenta como confirmación solo si
 * el mensaje es corto, EMPIEZA por una afirmación explícita y no contiene ninguna negación, duda o
 * condición. Ante cualquier ambigüedad se trata como "no confirmado".
 * El front además envía `confirm: true|false` desde los botones, que tiene prioridad (ver ciclo.ts).
 * Esta función no sabe si hay una acción pendiente: eso lo controla el ciclo, que solo la consulta
 * en el turno inmediatamente posterior a una solicitud de confirmación.
 */
const LARGO_MAXIMO = 80

/** Primeras palabras aceptadas (texto ya normalizado: sin tildes, minúsculas, sin puntuación). */
const AFIRMACION_INICIAL =
  /^(si|confirmo|confirmado|confirmada|ok|okay|dale|adelante|procede|proceda|de acuerdo|aprobado|apruebo|envia|envialo|enviar|enviala)\b/

/** Palabras o giros que anulan la confirmación aunque el mensaje empiece afirmando. */
const NEGACION_O_DUDA =
  /\b(no|ni|cancela|cancelar|cancelo|cancelalo|espera|esperar|todavia|aun|despues|luego|nunca|pero|aunque|mejor|duda|dudas|revisa|revisar|cuando|antes|si no|sino|tal vez|quizas|quiza)\b/

const esPregunta = (texto: string): boolean => /^\s*¿/.test(texto) || /\?\s*$/.test(texto)

export function esConfirmacionExplicita(texto: string): boolean {
  if (esPregunta(texto)) return false
  const t = normalizar(texto).replace(/\s+/g, " ")
  if (!t || t.length > LARGO_MAXIMO) return false
  return AFIRMACION_INICIAL.test(t) && !NEGACION_O_DUDA.test(t)
}
