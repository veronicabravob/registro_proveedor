import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import * as modulo from "../modulo/tools/proveedor.ts"
import { piezasDelModulo } from "../scripts/generar-modulo.ts"
import * as app from "../src/tools/proveedor.ts"

const raiz = fileURLToPath(new URL("..", import.meta.url))

describe("bonus · módulo reutilizable (PRD §9.4)", () => {
  it("las tres piezas están sincronizadas con las fuentes de la aplicación", () => {
    for (const [ruta, esperado] of Object.entries(piezasDelModulo())) {
      const actual = readFileSync(join(raiz, ruta), "utf8").replaceAll("\r\n", "\n")
      assert.equal(actual, esperado, `${ruta} está desactualizado: ejecuta npm run modulo`)
    }
  })

  it("las herramientas del módulo son exactamente los mismos objetos que usa el servidor", () => {
    assert.deepEqual(Object.keys(modulo).sort(), Object.keys(app).sort())
    for (const nombre of Object.keys(app) as (keyof typeof app)[]) assert.equal(modulo[nombre], app[nombre])
  })

  it("agent.md declara modo primario y niega edit y bash", () => {
    const agente = readFileSync(join(raiz, "modulo/agent.md"), "utf8")
    assert.match(agente, /^---\ndescription: .+\nmode: primary\npermission:\n {2}edit: deny\n {2}bash: deny\n---/)
  })

  it("las herramientas del módulo funcionan sin el servidor", async () => {
    const r = JSON.parse(
      await modulo.leer_solicitud.execute({ caso: "co-industrias-delta" }, { directory: raiz, sessionId: "modulo" }),
    ) as {
      ok: boolean
    }
    assert.equal(r.ok, true)
  })
})
