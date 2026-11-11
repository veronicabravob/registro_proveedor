import assert from "node:assert/strict"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { BitacoraGlobal } from "../src/agent/bitacora.ts"
import { type DependenciasCiclo, ejecutarTurno } from "../src/agent/ciclo.ts"
import { esConfirmacionExplicita } from "../src/agent/confirmacion.ts"
import { type EventoAgente, observadorNulo } from "../src/agent/observador.ts"
import { cargarSistema } from "../src/agent/prompt.ts"
import { AlmacenSesiones, type Sesion } from "../src/agent/sesiones.ts"
import { type AdaptadorLlm, ErrorLlm, type Mensaje, type PeticionLlm, type Respuesta, usoVacio } from "../src/llm/adapter.ts"
import { herramientas } from "../src/tools/index.ts"

/**
 * LLM simulado y determinista: cada paso del guion recibe el historial y decide la respuesta.
 * Permite probar el ciclo completo (ReAct, topes, confirmación humana, errores) sin red ni clave.
 */
type Paso = (mensajes: readonly Mensaje[]) => Respuesta

class LlmGuionado implements AdaptadorLlm {
  readonly proveedor = "simulado"
  readonly modelo = "guion"
  peticiones: PeticionLlm[] = []
  constructor(private readonly pasos: Paso[]) {}
  async enviar(p: PeticionLlm): Promise<Respuesta> {
    this.peticiones.push({ ...p, mensajes: [...p.mensajes] })
    const paso = this.pasos.shift()
    if (!paso) throw new Error("guion agotado")
    return paso(p.mensajes)
  }
}

const uso = { entrada: 100, salida: 20, cacheLectura: 0, cacheEscritura: 0 }
let n = 0
const llamar =
  (nombre: string, args: (m: readonly Mensaje[]) => unknown): Paso =>
  (m) => ({
    mensaje: { rol: "asistente", partes: [{ tipo: "llamada", id: `t${++n}`, nombre, args: args(m) }] },
    motivo: "herramientas",
    uso,
    modelo: "guion",
  })
const responder =
  (texto: string): Paso =>
  () => ({ mensaje: { rol: "asistente", partes: [{ tipo: "texto", texto }] }, motivo: "fin_turno", uso, modelo: "guion" })

/** Extrae un campo del último resultado de herramienta del historial. */
function ultimoDato(m: readonly Mensaje[], campo: string): unknown {
  for (const msg of [...m].reverse())
    for (const p of msg.partes)
      if (p.tipo === "resultado") return (JSON.parse(p.contenido) as { data?: Record<string, unknown> }).data?.[campo]
  return undefined
}

let dir: string
let eventos: EventoAgente[]
const sesiones = new AlmacenSesiones(10, 60_000)

function deps(llm: AdaptadorLlm, limites = { iteraciones: 25, tokensSesion: 1_000_000 }): DependenciasCiclo {
  return {
    llm,
    herramientas,
    sistema: "sistema de prueba",
    directorio: dir,
    limites,
    fechaEjecucion: "2026-09-15",
    observador: { envolver: observadorNulo.envolver, evento: (e) => eventos.push(e) },
    bitacora: new BitacoraGlobal(join(dir, "out")),
  }
}

const procesarCaso = (caso: string): Paso[] => [
  llamar("proveedor_leer_solicitud", () => ({ caso })),
  llamar("proveedor_mapear_campos", () => ({ caso, campos: [] })),
  llamar("proveedor_generar_formulario", (m) => ({ caso, mapeo: ultimoDato(m, "mapeo_id") })),
  llamar("proveedor_armar_paquete", () => ({ caso })),
  responder(`Caso ${caso} procesado. ¿Deseas simular el envío?`),
]

before(() => {
  dir = mkdtempSync(join(tmpdir(), "reto01-ciclo-"))
  cpSync(fileURLToPath(new URL("../../fixtures", import.meta.url)), join(dir, "fixtures"), { recursive: true })
})
after(() => rmSync(dir, { recursive: true, force: true }))

describe("ciclo del agente", () => {
  let sesion: Sesion
  before(() => {
    sesion = sesiones.crear()
    eventos = []
  })

  it("procesa un caso de punta a punta con herramientas visibles (HU-1..4, CA4)", async () => {
    const r = await ejecutarTurno(deps(new LlmGuionado(procesarCaso("co-industrias-delta"))), sesion, {
      texto: "Procesa co-industrias-delta",
    })
    assert.deepEqual(
      r.toolCalls.map((t) => [t.nombre, t.ok]),
      [
        ["proveedor_leer_solicitud", true],
        ["proveedor_mapear_campos", true],
        ["proveedor_generar_formulario", true],
        ["proveedor_armar_paquete", true],
      ],
    )
    assert.equal(r.needsConfirmation, false)
    assert.equal(r.iteraciones, 5)
    assert.ok(existsSync(join(dir, "out/co-industrias-delta/formulario.xlsx")))
    const log = readFileSync(join(dir, "out/log.jsonl"), "utf8").trim().split("\n")
    assert.equal(log.length, 4)
    assert.ok(eventos.some((e) => e.tipo === "paquete" && e.listo))
  })

  it("pide confirmación y no envía sin ella (CA3, RN4)", async () => {
    const llm = new LlmGuionado([
      llamar("proveedor_solicitar_confirmacion", () => ({
        caso: "co-industrias-delta",
        accion: "simular_envio",
        resumen: "Enviar paquete",
      })),
      // Aunque el modelo intente enviar en el mismo turno, el host lo bloquea.
      llamar("proveedor_simular_envio", () => ({ caso: "co-industrias-delta", confirmado: true })),
      responder("¿Confirmas que simule el envío? Responde sí o no."),
    ])
    const r = await ejecutarTurno(deps(llm), sesion, { texto: "envía" })
    assert.equal(r.needsConfirmation, true)
    assert.equal(r.toolCalls[1]?.ok, false)
    assert.equal(r.toolCalls[1]?.resumen, "requiere confirmación explícita")
    assert.equal(existsSync(join(dir, "out/co-industrias-delta/ENVIO-SIMULADO.md")), false)
    assert.equal(sesion.pendiente?.caso, "co-industrias-delta")
  })

  it("tras confirmación explícita ejecuta solo el envío simulado", async () => {
    const llm = new LlmGuionado([
      llamar("proveedor_simular_envio", () => ({ caso: "co-industrias-delta", confirmado: true })),
      responder("Listo: envío simulado."),
    ])
    const r = await ejecutarTurno(deps(llm), sesion, { texto: "Sí, confirmo" })
    assert.equal(r.toolCalls[0]?.ok, true)
    assert.ok(existsSync(join(dir, "out/co-industrias-delta/ENVIO-SIMULADO.md")))
    assert.equal(sesion.pendiente, null)
    const nota = llm.peticiones[0]?.mensajes.at(-1)?.partes.at(-1)
    assert.match(nota?.tipo === "texto" ? nota.texto : "", /CONFIRMÓ/)
  })

  it("una respuesta negativa consume la confirmación pendiente", async () => {
    const s = sesiones.crear()
    s.pendiente = { accion: "simular_envio", caso: "ec-corp-andina", detalle: "" }
    const llm = new LlmGuionado([
      llamar("proveedor_simular_envio", () => ({ caso: "ec-corp-andina", confirmado: true })),
      responder("Entendido, no envío."),
    ])
    const r = await ejecutarTurno(deps(llm), s, { texto: "no, espera" })
    assert.equal(r.toolCalls[0]?.ok, false)
    assert.equal(s.pendiente, null)
  })
})

describe("topes y errores", () => {
  it("CA1: al tope de iteraciones responde con lo hecho y deja el historial consistente", async () => {
    const s = sesiones.crear()
    const pasos = Array.from({ length: 3 }, () => llamar("proveedor_leer_solicitud", () => ({ caso: "ec-corp-andina" })))
    const r = await ejecutarTurno(deps(new LlmGuionado(pasos), { iteraciones: 3, tokensSesion: 1_000_000 }), s, { texto: "hola" })
    assert.match(r.reply, /tope de 3 pasos/)
    assert.equal(r.toolCalls.length, 3)
    assert.equal(s.mensajes.at(-1)?.partes[0]?.tipo, "resultado")
  })

  it("tope de tokens por sesión: no llama al modelo", async () => {
    const s = sesiones.crear()
    s.uso = { ...usoVacio(), entrada: 5000 }
    const llm = new LlmGuionado([])
    const r = await ejecutarTurno(deps(llm, { iteraciones: 5, tokensSesion: 1000 }), s, { texto: "hola" })
    assert.match(r.reply, /tope de/)
    assert.equal(llm.peticiones.length, 0)
  })

  it("CA5: un error del proveedor se muestra claro y la sesión sigue viva", async () => {
    const s = sesiones.crear()
    const falla: AdaptadorLlm = {
      proveedor: "simulado",
      modelo: "guion",
      enviar: async () => {
        throw new ErrorLlm("timeout", "El modelo tardó demasiado en responder.", true)
      },
    }
    const r = await ejecutarTurno(deps(falla), s, { texto: "hola" })
    assert.equal(r.error?.tipo, "timeout")
    assert.match(r.reply, /tardó demasiado/)
    const r2 = await ejecutarTurno(deps(new LlmGuionado([responder("Hola de nuevo")])), s, { texto: "¿sigues?" })
    assert.equal(r2.reply, "Hola de nuevo")
  })

  it("valida argumentos y rechaza herramientas desconocidas sin lanzar", async () => {
    const s = sesiones.crear()
    const llm = new LlmGuionado([
      llamar("proveedor_leer_solicitud", () => ({ caso: 42 })),
      llamar("borrar_todo", () => ({})),
      responder("No pude."),
    ])
    const r = await ejecutarTurno(deps(llm), s, { texto: "x" })
    assert.match(r.toolCalls[0]?.resumen ?? "", /Argumentos inválidos/)
    assert.match(r.toolCalls[1]?.resumen ?? "", /desconocida/)
  })

  it("un rechazo del modelo no deja llamadas sin respuesta en el historial", async () => {
    const s = sesiones.crear()
    const rechazo: Paso = () => ({ mensaje: { rol: "asistente", partes: [] }, motivo: "rechazo", uso, modelo: "guion" })
    const r = await ejecutarTurno(deps(new LlmGuionado([rechazo])), s, { texto: "x" })
    assert.match(r.reply, /no puede ayudar/)
    assert.equal(s.mensajes.length, 1)
  })
})

describe("piezas del ciclo", () => {
  it("detecta confirmaciones explícitas de forma conservadora", () => {
    for (const si of ["sí", "Sí, confirmo", "confirmo", "envíalo", "OK", "adelante"])
      assert.equal(esConfirmacionExplicita(si), true, si)
    for (const no of [
      "no",
      "no envíes",
      "sí pero espera",
      "¿qué falta?",
      "envía cuando esté listo el certificado nuevo y avísame",
    ])
      assert.equal(esConfirmacionExplicita(no), false, no)
  })

  it("las sesiones expiran por TTL y respetan el máximo (LRU)", () => {
    let t = 0
    const almacen = new AlmacenSesiones(2, 1000, () => t)
    const a = almacen.crear("sesion-a1")
    almacen.crear("sesion-b1")
    almacen.obtener(a.id)
    almacen.crear("sesion-c1")
    assert.ok(almacen.obtener("sesion-a1"))
    assert.equal(almacen.obtener("sesion-b1"), undefined)
    t = 5000
    assert.equal(almacen.obtener("sesion-a1"), undefined)
  })

  it("el system prompt une comportamiento y conocimiento y es estable", () => {
    const raiz = fileURLToPath(new URL("..", import.meta.url))
    const s = cargarSistema(raiz)
    assert.match(s, /Fuente de verdad/)
    assert.match(s, /RN1/)
    assert.equal(s, cargarSistema(raiz))
  })
})
