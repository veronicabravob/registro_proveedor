import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import type { CampoSolicitado, Maestro } from "../src/tools/lib/datos.ts"
import { notaLegible } from "../src/tools/lib/formulario-pdf.ts"
import { mapearCampos, resolverEtiquetas, valorParaFormulario } from "../src/tools/lib/mapeo.ts"
import { reglas } from "../src/tools/lib/reglas.ts"
import { agruparMiles, tiposDeDato } from "../src/tools/lib/texto.ts"

// Pruebas puras del mapeo: solo LEEN los fixtures del repositorio; no escriben en disco.
const fixtures = fileURLToPath(new URL("../../fixtures/reto-01/", import.meta.url))
const maestro = JSON.parse(readFileSync(join(fixtures, "repositorio/maestro.json"), "utf8")) as Maestro
const glosario = JSON.parse(readFileSync(join(fixtures, "glosario-campos.json"), "utf8")) as Record<string, string>
const r = reglas()

const campos = (...etiquetas: string[]): CampoSolicitado[] => etiquetas.map((etiqueta) => ({ etiqueta, obligatorio: null }))
const mapear = (pais: string, ...etiquetas: string[]) => mapearCampos("prueba", campos(...etiquetas), pais, maestro, glosario, r)

describe("mapeo · coincidencias aproximadas (regresión)", () => {
  const conflictivas = ["Teléfono contacto financiero", "Correo del representante legal", "Teléfono del representante legal"]

  it("una etiqueta con tipo de dato distinto nunca queda llena con el nombre", () => {
    const m = mapear("CO", ...conflictivas)
    assert.deepEqual(m.llenos, [])
    const claves = [...m.requiere_confirmacion.map((c) => c.clave)]
    assert.ok(!claves.some((c) => c.endsWith(".nombre")), `no debe proponer un nombre: ${claves.join(", ")}`)
  })

  it("correo del representante legal: propone su correo del maestro, para confirmar", () => {
    const m = mapear("CO", "Correo del representante legal")
    assert.equal(m.llenos.length, 0)
    assert.equal(m.requiere_confirmacion[0]?.clave, "representante_legal.email")
  })

  it("teléfono del representante legal queda faltante (el maestro no lo tiene)", () => {
    const m = mapear("CO", "Teléfono del representante legal")
    assert.deepEqual(
      m.faltantes.map((f) => f.etiqueta),
      ["Teléfono del representante legal"],
    )
  })

  it("teléfono del contacto financiero: propone el de esa persona (ruta del maestro), para confirmar", () => {
    const m = mapear("CO", "Teléfono contacto financiero")
    assert.equal(m.llenos.length, 0)
    const pc = m.requiere_confirmacion[0]
    assert.equal(pc?.clave, "contacto_financiero.telefono")
    assert.match(pc?.motivo ?? "", /coincidencia aproximada/)
  })

  it("una coincidencia por similitud nunca queda llena, aunque supere el umbral", () => {
    const m = mapear("CO", "Nombre legal de la empresa proveedora", "Número del RUT")
    assert.equal(m.llenos.length, 0)
    assert.deepEqual(
      m.requiere_confirmacion.map((c) => c.etiqueta),
      ["Nombre legal de la empresa proveedora"],
    )
  })

  it("el glosario exacto sigue llenando con confianza 1", () => {
    const m = mapear("CO", "Teléfono contacto comercial", "Representante legal")
    assert.deepEqual(
      m.llenos.map((c) => [c.clave, c.confianza]),
      [
        ["contacto_comercial.telefono", 1],
        ["representante_legal.nombre", 1],
      ],
    )
  })

  it("detecta tipos de dato por tokens, incluso en plural y sin tilde", () => {
    assert.deepEqual([...tiposDeDato("Teléfonos de contacto", r.tipos_de_dato)], ["telefono"])
    assert.deepEqual([...tiposDeDato("E-mail facturacion", r.tipos_de_dato)], ["correo"])
    assert.deepEqual([...tiposDeDato("Representante legal", r.tipos_de_dato)], [])
  })
})

describe("mapeo · valores monetarios", () => {
  it("los ingresos se escriben con la moneda del maestro", () => {
    const m = mapear("HN", "Ingresos anuales")
    assert.equal(m.llenos[0]?.valor, "COP 98.000.000.000")
  })

  it("sin moneda en el maestro el valor queda por confirmar, sin inventarla", () => {
    const sinMoneda = { ...maestro, ingresos_ultimo_ano: { valor: 5000, ano: 2025 } }
    const m = mapearCampos("prueba", campos("Ingresos anuales"), "HN", sinMoneda, glosario, r)
    assert.equal(m.llenos.length, 0)
    assert.equal(m.requiere_confirmacion[0]?.valor_propuesto, "5000")
    assert.match(m.requiere_confirmacion[0]?.motivo ?? "", /sin moneda/)
  })

  it("agrupa miles con punto y decimales con coma", () => {
    assert.equal(agruparMiles(98000000000), "98.000.000.000")
    assert.equal(agruparMiles(1234.5), "1.234,5")
    assert.equal(agruparMiles(999), "999")
  })
})

describe("mapeo · etiquetas del modelo vs. plantilla", () => {
  const plantilla = campos("Razón social", "Dirección", "Número de cuenta")

  it("resuelve etiquetas reescritas (sin tilde, mayúsculas) a la etiqueta exacta de la plantilla", () => {
    const r1 = resolverEtiquetas(["razon social", "DIRECCION", "Referencias"], plantilla)
    assert.deepEqual(r1, { etiquetas: ["Razón social", "Dirección"], no_encontradas: ["Referencias"] })
  })

  it("el formulario encuentra el valor aunque la etiqueta llegue sin tilde", () => {
    const m = mapearCampos("prueba", plantilla, "CO", maestro, glosario, r)
    assert.equal(valorParaFormulario(m, "Direccion").valor, "Calle 10 # 43A-25, Oficina 501")
  })
})

describe("formulario PDF · notas de los campos por confirmar", () => {
  it("en Colombia una etiqueta ambigua usa el motivo real, no 'sin identificador en Colombia'", () => {
    const m = mapear("CO", "Identificación tributaria")
    const nota = notaLegible(m, "Identificación tributaria", "requiere_confirmacion", "CO") ?? ""
    assert.match(nota, /etiqueta ambigua/i)
    assert.doesNotMatch(nota, /no tiene identificador/)
  })

  it("para un cliente extranjero explica que es el NIT colombiano", () => {
    const m = mapear("EC", "RUC")
    assert.match(notaLegible(m, "RUC", "requiere_confirmacion", "EC") ?? "", /NIT colombiano.*Ecuador/)
  })
})
