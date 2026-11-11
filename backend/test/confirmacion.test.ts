import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { esConfirmacionExplicita } from "../src/agent/confirmacion.ts"
import { PresupuestoDiario } from "../src/agent/sesiones.ts"
import { ipCliente } from "../src/http/seguridad.ts"

describe("confirmación escrita (CA3, RN4)", () => {
  it("acepta afirmaciones explícitas, incluido el texto del botón del front", () => {
    for (const si of [
      "sí",
      "Sí, confirmo el envío.",
      "sí, envía el paquete",
      "ok, adelante",
      "si por favor envialo",
      "confirmo",
      "dale",
      "  Sí,   confirmo  ",
      "De acuerdo, procede",
    ])
      assert.equal(esConfirmacionExplicita(si), true, si)
  })

  it("rechaza negaciones, dudas, condiciones y preguntas", () => {
    for (const no of [
      "No, todavía no.",
      "sí, pero espera",
      "no",
      "¿sí?",
      "sí?",
      "sí pero revisa primero",
      "mejor no",
      "si no está listo no lo envíes",
      "envía cuando esté listo el certificado",
      "quizás sí",
      "",
      `sí ${"muy ".repeat(30)}seguro`,
    ])
      assert.equal(esConfirmacionExplicita(no), false, no)
  })
})

describe("tope global diario de tokens (PRD §8)", () => {
  it("acumula entre sesiones y se reinicia al cambiar el día UTC", () => {
    let t = Date.parse("2026-11-10T23:59:00Z")
    const p = new PresupuestoDiario(1000, () => t)
    p.registrar(600)
    assert.equal(p.agotado(), false)
    p.registrar(400)
    assert.equal(p.agotado(), true)
    t = Date.parse("2026-11-11T00:00:01Z")
    assert.equal(p.consumidos, 0)
    assert.equal(p.agotado(), false)
  })
})

describe("IP del cliente para el límite por minuto", () => {
  it("usa el valor que agrega el proxy de confianza, no el que envía el cliente", () => {
    assert.equal(ipCliente("1.1.1.1, 203.0.113.7", 1), "203.0.113.7")
    assert.equal(ipCliente("1.1.1.1, 203.0.113.7, 10.0.0.2", 2), "203.0.113.7")
    assert.equal(ipCliente("203.0.113.7", 3), "203.0.113.7")
    assert.equal(ipCliente(undefined, 1), "local")
    assert.equal(ipCliente("1.1.1.1", 0), "directo")
  })
})
