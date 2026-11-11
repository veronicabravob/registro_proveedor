import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { BitacoraGlobal } from "../src/agent/bitacora.ts"
import type { DependenciasCiclo } from "../src/agent/ciclo.ts"
import { observadorNulo } from "../src/agent/observador.ts"
import { AlmacenSesiones } from "../src/agent/sesiones.ts"
import { cargarConfiguracion } from "../src/config.ts"
import { crearApp } from "../src/http/app.ts"
import { claveValida } from "../src/http/seguridad.ts"
import type { AdaptadorLlm, Respuesta } from "../src/llm/adapter.ts"
import { herramientas } from "../src/tools/index.ts"

const raizRepo = fileURLToPath(new URL("../..", import.meta.url))
let dir: string
const uso = { entrada: 10, salida: 5, cacheLectura: 0, cacheEscritura: 0 }

function llmQue(respuestas: Respuesta[]): AdaptadorLlm {
  return { proveedor: "anthropic", modelo: "guion", enviar: async () => respuestas.shift() ?? assert.fail("guion agotado") }
}
const texto = (t: string): Respuesta => ({
  mensaje: { rol: "asistente", partes: [{ tipo: "texto", texto: t }] },
  motivo: "fin_turno",
  uso,
  modelo: "guion",
})
const llamada = (nombre: string, args: unknown): Respuesta => ({
  mensaje: { rol: "asistente", partes: [{ tipo: "llamada", id: `id-${nombre}`, nombre, args }] },
  motivo: "herramientas",
  uso,
  modelo: "guion",
})

function app(opciones: { llm?: AdaptadorLlm | null; env?: Record<string, string> } = {}) {
  const config = cargarConfiguracion({ NODE_ENV: "test", ...(opciones.env ?? {}) }, false)
  const ciclo: DependenciasCiclo | null =
    opciones.llm === null
      ? null
      : {
          llm: opciones.llm ?? llmQue([texto("hola")]),
          herramientas,
          sistema: "s",
          directorio: dir,
          limites: { iteraciones: 10, tokensSesion: 100_000 },
          fechaEjecucion: "2026-09-15",
          observador: observadorNulo,
          bitacora: new BitacoraGlobal(join(dir, "out")),
        }
  return crearApp({
    config,
    raiz: dir,
    almacen: new AlmacenSesiones(10, 60_000),
    ciclo,
    telemetria: { trazas: [], metricas: [], contenido: "metadata_only" },
    dirWeb: join(dir, "web"),
  })
}

const post = (cuerpo: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(cuerpo),
})

before(() => {
  dir = mkdtempSync(join(tmpdir(), "reto01-api-"))
  cpSync(join(raizRepo, "fixtures"), join(dir, "fixtures"), { recursive: true })
  mkdirSync(join(dir, "web"))
  writeFileSync(join(dir, "web", "index.html"), "<!doctype html><title>Registro como Proveedor</title>")
})
after(() => rmSync(dir, { recursive: true, force: true }))

describe("API", () => {
  it("GET /api/health informa proveedor y modelo sin exponer claves", async () => {
    const r = await app({ env: { ANTHROPIC_API_KEY: "sk-ant-secreta" } }).request("/api/health")
    const cuerpo = await r.text()
    assert.equal(r.status, 200)
    assert.match(cuerpo, /"provider":"anthropic"/)
    assert.doesNotMatch(cuerpo, /sk-ant-secreta/)
    assert.ok(r.headers.get("content-security-policy"))
  })

  it("GET /api/casos lista los casos con su formato", async () => {
    const r = await app().request("/api/casos")
    const { casos } = (await r.json()) as { casos: { caso: string; formato: string }[] }
    assert.deepEqual(
      casos.map((c) => c.formato),
      ["xlsx", "pdf", "xlsx", "portal"],
    )
  })

  it("POST /api/chat valida el cuerpo", async () => {
    const r = await app().request("/api/chat", post({ message: "" }))
    assert.equal(r.status, 400)
  })

  it("POST /api/chat responde 503 si no hay modelo configurado", async () => {
    const r = await app({ llm: null }).request("/api/chat", post({ message: "hola" }))
    assert.equal(r.status, 503)
  })

  it("conversación completa: chat → herramientas → confirmación → historial", async () => {
    const a = app({
      llm: llmQue([
        llamada("proveedor_leer_solicitud", { caso: "ec-corp-andina" }),
        llamada("proveedor_solicitar_confirmacion", { caso: "ec-corp-andina", accion: "simular_envio", resumen: "Enviar" }),
        texto("¿Confirmas el envío? Responde sí o no."),
      ]),
    })
    const r = await a.request("/api/chat", post({ message: "procesa y envía ec-corp-andina" }))
    const c = (await r.json()) as {
      sessionId: string
      toolCalls: unknown[]
      needsConfirmation: boolean
      pendingAction: { caso: string }
    }
    assert.equal(r.status, 200)
    assert.equal(c.toolCalls.length, 2)
    assert.equal(c.needsConfirmation, true)
    assert.equal(c.pendingAction.caso, "ec-corp-andina")

    const h = await a.request(`/api/sessions/${c.sessionId}`)
    const hist = (await h.json()) as { messages: { rol: string }[]; pendingAction: unknown }
    assert.deepEqual(
      hist.messages.map((m) => m.rol),
      ["usuario", "asistente"],
    )
    assert.ok(hist.pendingAction)
  })

  it("GET /api/sessions/:id inexistente → 404", async () => {
    assert.equal((await app().request("/api/sessions/no-existe-123")).status, 404)
  })

  it("descarga archivos de out/ y bloquea rutas fuera de out/", async () => {
    const a = app({
      llm: llmQue([llamada("proveedor_armar_paquete", { caso: "hn-agroexport-sula" }), texto("listo")]),
    })
    await a.request("/api/chat", post({ message: "arma el paquete" }))
    const ok = await a.request("/api/archivos/out/hn-agroexport-sula/paquete/checklist.md")
    assert.equal(ok.status, 200)
    assert.match(await ok.text(), /NO LISTO PARA FIRMA/)
    assert.equal((await a.request("/api/archivos/fixtures/reto-01/repositorio/maestro.json")).status, 403)
    assert.equal((await a.request("/api/archivos/out/..%2F..%2Fpackage.json")).status, 403)
    assert.equal((await a.request("/api/archivos/out/no/existe.md")).status, 404)
  })

  it("con APP_ACCESS_KEY exige la clave (salvo health)", async () => {
    const a = app({ env: { APP_ACCESS_KEY: "clave-demo" } })
    assert.equal((await a.request("/api/casos")).status, 401)
    assert.equal((await a.request("/api/casos", { headers: { "x-access-key": "clave-demo" } })).status, 200)
    assert.equal((await a.request("/api/health")).status, 200)
    assert.equal(claveValida(undefined, "x"), false)
  })

  it("limita solicitudes por minuto (protege la clave del modelo)", async () => {
    const a = app({ env: { RATE_LIMIT_PER_MINUTE: "1" }, llm: llmQue([texto("uno"), texto("dos")]) })
    assert.equal((await a.request("/api/chat", post({ message: "1" }))).status, 200)
    assert.equal((await a.request("/api/chat", post({ message: "2" }))).status, 429)
  })

  it("sirve el front estático y responde 404 JSON en rutas de API desconocidas", async () => {
    const a = app()
    const index = await a.request("/")
    assert.equal(index.status, 200)
    assert.match(await index.text(), /Registro como Proveedor/)
    assert.equal((await a.request("/api/nada")).status, 404)
  })
})

describe("configuración", () => {
  it("las variables vacías de .env.example equivalen a no definidas", () => {
    const c = cargarConfiguracion({ FECHA_EJECUCION: "", APP_ACCESS_KEY: "  ", PORT: "" }, false)
    assert.equal(c.fechaEjecucion, undefined)
    assert.equal(c.claveAcceso, undefined)
    assert.equal(c.puerto, 3000)
  })

  it("rechaza valores inválidos con un mensaje claro", () => {
    assert.throws(() => cargarConfiguracion({ LLM_EFFORT: "turbo" }, false), /Configuración inválida: LLM_EFFORT/)
  })
})
