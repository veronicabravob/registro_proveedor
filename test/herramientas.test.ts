import assert from "node:assert/strict"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import ExcelJS from "exceljs"
import * as proveedor from "../src/tools/proveedor.ts"
import { leerResultado, type ToolContext } from "../src/tools/types.ts"

// Cada prueba corre sobre una copia de los fixtures en un directorio temporal: nunca toca el repo.
const raizRepo = fileURLToPath(new URL("..", import.meta.url))
let ctx: ToolContext

const FECHA = "2026-09-15" // fecha fija: vigencias deterministas

async function ejecutar(salida: Promise<string>): Promise<Record<string, unknown>> {
  const r = leerResultado(await salida)
  if (!r.ok) assert.fail(r.error)
  return r.data
}

async function procesar(caso: string): Promise<{ mapeo: Record<string, unknown>; paquete: Record<string, unknown> }> {
  const mapeo = await ejecutar(proveedor.mapear_campos.execute({ caso, campos: [] }, ctx))
  await ejecutar(proveedor.generar_formulario.execute({ caso, mapeo: String(mapeo.mapeo_id) }, ctx))
  const paquete = await ejecutar(proveedor.armar_paquete.execute({ caso }, ctx))
  return { mapeo, paquete }
}

const etiquetas = (v: unknown): string[] => (v as { etiqueta: string }[]).map((c) => c.etiqueta)

before(() => {
  const dir = mkdtempSync(join(tmpdir(), "reto01-"))
  cpSync(join(raizRepo, "fixtures"), join(dir, "fixtures"), { recursive: true })
  ctx = { directory: dir, sessionId: "test", fechaEjecucion: FECHA }
})
after(() => rmSync(ctx.directory, { recursive: true, force: true }))

describe("HU-1 · leer_solicitud", () => {
  it("devuelve país, formato, campos y soportes", async () => {
    const d = await ejecutar(proveedor.leer_solicitud.execute({ caso: "ec-corp-andina" }, ctx))
    assert.equal(d.pais, "EC")
    assert.equal(d.formato, "pdf")
    assert.equal((d.campos as unknown[]).length, 15)
    assert.equal((d.soportes as unknown[]).length, 5)
    assert.equal(d.identificador_tributario_pais, "RUC")
  })

  it("reporta etiquetas ambiguas con el equivalente del país", async () => {
    const plantilla = join(ctx.directory, "fixtures/reto-01/casos/ec-corp-andina/plantilla-campos.json")
    const original = readFileSync(plantilla, "utf8")
    try {
      writeFileSync(plantilla, JSON.stringify([{ etiqueta: "Identificación tributaria", obligatorio: true }]))
      const d = await ejecutar(proveedor.leer_solicitud.execute({ caso: "ec-corp-andina" }, ctx))
      const ambiguos = d.campos_ambiguos as { etiqueta: string; propuesta: string }[]
      assert.equal(ambiguos[0]?.etiqueta, "Identificación tributaria")
      assert.match(ambiguos[0]?.propuesta ?? "", /RUC/)
    } finally {
      writeFileSync(plantilla, original)
    }
  })
})

describe("HU-2 · mapear_campos", () => {
  it("Colombia: todo lleno desde el maestro, con ruta trazable", async () => {
    const d = await ejecutar(proveedor.mapear_campos.execute({ caso: "co-industrias-delta", campos: [] }, ctx))
    assert.equal((d.llenos as unknown[]).length, 17)
    assert.equal((d.faltantes as unknown[]).length, 0)
    const nit = (d.llenos as { etiqueta: string; ruta: string; valor: string }[]).find((c) => c.etiqueta === "NIT")
    assert.deepEqual([nit?.ruta, nit?.valor], ["maestro.json#nit", "900123456"])
  })

  it("RN1: identificador extranjero queda requiere_confirmacion con el NIT", async () => {
    const d = await ejecutar(proveedor.mapear_campos.execute({ caso: "hn-agroexport-sula", campos: [] }, ctx))
    const rtn = (d.requiere_confirmacion as { etiqueta: string; valor_propuesto: string; motivo: string }[])[0]
    assert.equal(rtn?.etiqueta, "RTN")
    assert.equal(rtn?.valor_propuesto, "900123456")
    assert.match(rtn?.motivo ?? "", /identificador extranjero/)
  })

  it("nunca inventa: un campo sin fuente es faltante", async () => {
    const d = await ejecutar(proveedor.mapear_campos.execute({ caso: "hn-agroexport-sula", campos: [] }, ctx))
    assert.deepEqual(etiquetas(d.faltantes), ["Referencias comerciales"])
    const ec = await ejecutar(proveedor.mapear_campos.execute({ caso: "ec-corp-andina", campos: [] }, ctx))
    assert.deepEqual(etiquetas(ec.faltantes), ["Número de contribuyente especial"])
  })

  it("etiqueta parecida con baja confianza → requiere_confirmacion", async () => {
    const d = await ejecutar(
      proveedor.mapear_campos.execute({ caso: "co-industrias-delta", campos: ["Nombre legal de la empresa proveedora"] }, ctx),
    )
    assert.deepEqual(etiquetas(d.requiere_confirmacion), ["Nombre legal de la empresa proveedora"])
  })
})

describe("HU-3 · generar_formulario", () => {
  it("P0 Excel: etiqueta y valor en la hoja y celda exactas, como texto", async () => {
    await procesar("co-industrias-delta")
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.readFile(join(ctx.directory, "out/co-industrias-delta/formulario.xlsx"))
    const banco = libro.getWorksheet("Datos Bancarios")
    assert.equal(banco?.getCell("B5").value, "Número de cuenta")
    assert.equal(banco?.getCell("C5").value, "03100012345") // conserva el cero inicial
    assert.equal(libro.getWorksheet("Datos Proveedor")?.getCell("C4").value, "900123456")
  })

  it("P1 PDF y P2 portal generan su archivo", async () => {
    await procesar("ec-corp-andina")
    assert.ok(existsSync(join(ctx.directory, "out/ec-corp-andina/formulario.pdf")))
    const portal = await procesar("pa-logistica-istmo")
    assert.ok(portal.mapeo)
    const md = readFileSync(join(ctx.directory, "out/pa-logistica-istmo/valores-portal.md"), "utf8")
    assert.match(md, /Formato no soportado/)
  })

  it("rechaza un mapeo_id que no corresponde (los valores nunca pasan por el modelo)", async () => {
    await ejecutar(proveedor.mapear_campos.execute({ caso: "co-industrias-delta", campos: [] }, ctx))
    const r = leerResultado(await proveedor.generar_formulario.execute({ caso: "co-industrias-delta", mapeo: "inventado" }, ctx))
    assert.equal(r.ok, false)
  })
})

describe("HU-4 · armar_paquete", () => {
  it("con todo vigente queda listo para firma y el correo no tiene datos bancarios (RN2)", async () => {
    const { paquete } = await procesar("co-industrias-delta")
    assert.equal(paquete.listo_para_firma, true)
    const correo = readFileSync(join(ctx.directory, "out/co-industrias-delta/paquete/borrador-correo.md"), "utf8")
    assert.doesNotMatch(correo, /03100012345|COLOCOBM|Bancolombia/)
    assert.ok(existsSync(join(ctx.directory, "out/co-industrias-delta/paquete/rut-2026.txt")))
  })

  it("RN3: soporte vencido o ausente bloquea; el faltante no", async () => {
    const hn = await procesar("hn-agroexport-sula")
    assert.equal(hn.paquete.listo_para_firma, false)
    assert.match(String(hn.paquete.bloqueos), /parafiscales/)

    const ec = await procesar("ec-corp-andina")
    assert.equal(ec.paquete.listo_para_firma, false)
    assert.match(String(ec.paquete.bloqueos), /cumplimiento tributario/)
    assert.doesNotMatch(String(ec.paquete.bloqueos), /contribuyente especial/)
  })

  it("RN5: cada ejecución queda en out/<caso>/log.jsonl", async () => {
    await procesar("co-industrias-delta")
    const lineas = readFileSync(join(ctx.directory, "out/co-industrias-delta/log.jsonl"), "utf8").trim().split("\n")
    const ultima = JSON.parse(lineas.at(-1) ?? "{}") as Record<string, unknown>
    assert.deepEqual(Object.keys(ultima).filter((k) => ["ts", "herramienta", "ok", "resumen"].includes(k)).length, 4)
  })
})

describe("RN4 · simular_envio", () => {
  it("sin confirmación explícita responde el error del contrato", async () => {
    await procesar("co-industrias-delta")
    const sinArg = leerResultado(await proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: false }, ctx))
    assert.deepEqual(sinArg, { ok: false, error: "requiere confirmación explícita" })
    const sinHost = leerResultado(
      await proveedor.simular_envio.execute(
        { caso: "co-industrias-delta", confirmado: true },
        { ...ctx, confirmaciones: new Set() },
      ),
    )
    assert.equal(sinHost.ok, false)
  })

  it("con aprobación del host escribe solo ENVIO-SIMULADO.md", async () => {
    await procesar("co-industrias-delta")
    const ok = { ...ctx, confirmaciones: new Set(["simular_envio:co-industrias-delta"]) }
    const d = await ejecutar(proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ok))
    assert.equal(d.ruta, "out/co-industrias-delta/ENVIO-SIMULADO.md")
  })
})

describe("HU-5 · errores claros, nunca excepciones", () => {
  it("caso inexistente", async () => {
    const r = leerResultado(await proveedor.leer_solicitud.execute({ caso: "no-existe" }, ctx))
    assert.equal(r.ok, false)
    assert.match(r.ok ? "" : r.error, /no existe/)
  })

  it("intento de path traversal", async () => {
    const r = leerResultado(await proveedor.armar_paquete.execute({ caso: "../../etc" }, ctx))
    assert.equal(r.ok, false)
  })

  it("plantilla corrupta: error claro y el paquete se arma igual", async () => {
    const plantilla = join(ctx.directory, "fixtures/reto-01/casos/hn-agroexport-sula/plantilla-celdas.json")
    const original = readFileSync(plantilla, "utf8")
    try {
      writeFileSync(plantilla, "{ esto no es json")
      const r = leerResultado(await proveedor.leer_solicitud.execute({ caso: "hn-agroexport-sula" }, ctx))
      assert.equal(r.ok, false)
      assert.match(r.ok ? "" : r.error, /corrupt/)
      assert.doesNotMatch(r.ok ? "" : r.error, /at .*\.ts/) // sin traza cruda
      const paquete = await ejecutar(proveedor.armar_paquete.execute({ caso: "hn-agroexport-sula" }, ctx))
      assert.equal(paquete.listo_para_firma, false)
    } finally {
      writeFileSync(plantilla, original)
    }
  })
})
