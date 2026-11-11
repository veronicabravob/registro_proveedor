import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { leerEventos } from "../api/cliente.ts"
import type { Llamada } from "../api/tipos.ts"
import { actualizarConversacion, cuando, estadoDe } from "./conversaciones.ts"
import { archivosDelCaso, calcularProgreso, casoDe, describirPaso, nombreCorto, pasoEnCurso } from "./pasos.ts"

const llamada = (nombre: string, resumen: string, ok = true): Llamada => ({
  id: nombre,
  nombre,
  args: { caso: "ec-corp-andina" },
  ok,
  resumen,
  duracionMs: 420,
})

const caso = [
  llamada("proveedor_leer_solicitud", "Formulario PDF con 15 campos y 5 soportes exigidos."),
  llamada("proveedor_mapear_campos", "13 llenos, 1 por confirmar, 1 sin dato."),
  llamada("proveedor_generar_formulario", "En el mismo formato del cliente (PDF): out/ec-corp-andina/formulario.pdf"),
  llamada("proveedor_armar_paquete", "No está listo para firma: 1 soporte vencido, 1 soporte ausente."),
]

describe("lenguaje de la analista", () => {
  it("cada paso técnico se describe sin jerga", () => {
    const textos = caso.map(describirPaso)
    assert.deepEqual(
      textos.map((t) => t.titulo),
      [
        "Leí la solicitud.",
        "Crucé los campos con el maestro.",
        "Generé el formulario",
        "Armé el paquete, pero no está listo para firma.",
      ],
    )
    for (const t of textos) assert.doesNotMatch(`${t.titulo} ${t.detalle}`, /proveedor_|out\/|\.ts|json/)
  })

  it("el portal y los errores se explican con claridad", () => {
    assert.equal(describirPaso(llamada("proveedor_generar_formulario", "Este cliente usa un portal web: …")).tono, "aviso")
    const bloqueado = describirPaso(llamada("proveedor_simular_envio", "requiere confirmación explícita", false))
    assert.equal(bloqueado.titulo, "No registré el envío.")
    assert.match(bloqueado.detalle, /confirmación/)
    assert.equal(pasoEnCurso("proveedor_armar_paquete").titulo, "Estoy armando el paquete.")
  })
})

describe("progreso del caso (5 puntos)", () => {
  it("marca hechos, bloqueos y el paso en curso", () => {
    const p = calcularProgreso(caso, null)
    assert.deepEqual(p.puntos, ["hecho", "hecho", "hecho", "error", "pendiente"])
    assert.equal(p.hechos, 4)
    assert.equal(p.etiqueta, "el paquete tiene un bloqueo")
    assert.deepEqual(calcularProgreso(caso.slice(0, 2), "proveedor_generar_formulario").puntos.slice(0, 3), [
      "hecho",
      "hecho",
      "curso",
    ])
  })

  it("detecta el caso y los archivos descargables", () => {
    assert.equal(casoDe(caso), "ec-corp-andina")
    assert.deepEqual(archivosDelCaso("ec-corp-andina", caso), [
      "out/ec-corp-andina/formulario.pdf",
      "out/ec-corp-andina/paquete/checklist.md",
      "out/ec-corp-andina/paquete/borrador-correo.md",
    ])
    assert.equal(nombreCorto("Corporación Andina de Servicios S.A."), "Corporación Andina")
    assert.equal(nombreCorto("Agroexport Sula S. de R.L."), "Agroexport Sula")
  })
})

describe("conversaciones recientes", () => {
  it("resume el estado en palabras de la analista", () => {
    assert.equal(estadoDe({ needsConfirmation: true, error: null }, caso), "espera tu respuesta")
    assert.equal(estadoDe({ needsConfirmation: false, error: null }, caso), "paquete con pendientes")
    const lista = actualizarConversacion([{ id: "a", titulo: "A", caso: null, estado: "", actualizada: "" }], {
      id: "b",
      titulo: "B",
      caso: null,
      estado: "",
      actualizada: "",
    })
    assert.deepEqual(
      lista.map((c) => c.id),
      ["b", "a"],
    )
    assert.match(cuando(new Date().toISOString()), /^Hoy/)
  })
})

describe("streaming", () => {
  it("interpreta bloques SSE aunque lleguen partidos", async () => {
    const partes = ['event: paso_inicio\ndata: {"id":"1",', '"nombre":"x"}\n\nevent: respuesta\r\ndata: {"reply":"ok"}\r\n\r\n']
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of partes) c.enqueue(new TextEncoder().encode(p))
        c.close()
      },
    })
    const eventos = []
    for await (const e of leerEventos(cuerpo)) eventos.push(e)
    assert.deepEqual(eventos, [
      { evento: "paso_inicio", datos: '{"id":"1","nombre":"x"}' },
      { evento: "respuesta", datos: '{"reply":"ok"}' },
    ])
  })
})

describe("textos para la analista", () => {
  it("quita rutas internas y formatea duraciones cortas", async () => {
    const { sinRutas, duracion } = await import("./pasos.ts")
    assert.equal(
      sinRutas("Simular envío del paquete out/ec-corp-andina/paquete (formulario.pdf) a x@y.ec."),
      "Simular envío del paquete (formulario.pdf) a x@y.ec.",
    )
    assert.equal(duracion(40), "< 0,1 s")
    assert.equal(duracion(1600), "1,6 s")
  })
})

describe("conversaciones antiguas", () => {
  it("guarda y recupera una copia local del historial", async () => {
    const memoria = new Map<string, string>()
    Object.assign(globalThis, {
      localStorage: {
        getItem: (k: string) => memoria.get(k) ?? null,
        setItem: (k: string, v: string) => void memoria.set(k, v),
        removeItem: (k: string) => void memoria.delete(k),
      },
    })
    const { guardarHistorial, leerHistorial, borrarHistorial } = await import("./conversaciones.ts")
    guardarHistorial("sesion-1", [{ tipo: "usuario", texto: "hola" }])
    assert.deepEqual(leerHistorial("sesion-1"), [{ tipo: "usuario", texto: "hola" }])
    assert.equal(leerHistorial("no-existe"), null)
    borrarHistorial("sesion-1")
    assert.equal(leerHistorial("sesion-1"), null)
  })
})
