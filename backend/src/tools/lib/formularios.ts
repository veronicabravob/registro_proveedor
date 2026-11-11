import { writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import type { CampoSolicitado, CeldaPlantilla, Solicitud } from "./datos.ts"
import { type Mapeo, valorParaFormulario } from "./mapeo.ts"

export interface Encabezado {
  caso: string
  solicitud: Solicitud
  fechaEjecucion: string
  /** Representante legal que firma (del maestro); se muestra en el bloque de firma del PDF. */
  firmante?: { nombre: string; cargo: string }
}

const MARCA = { requiere_confirmacion: "[REQUIERE CONFIRMACIÓN]", faltante: "[FALTANTE]" } as const

// ── P0 · Excel ───────────────────────────────────────────────────────────────────────────────

/**
 * Escribe cada etiqueta y su valor exactamente en la hoja y celdas de la plantilla (HU-3 P0).
 * Los valores se escriben como texto para no perder ceros a la izquierda (cuenta, NIT).
 * Faltantes y por confirmar quedan marcados con una nota de celda, sin valor inventado.
 */
export async function generarXlsx(celdas: readonly CeldaPlantilla[], mapeo: Mapeo, destino: string): Promise<number> {
  const libro = new ExcelJS.Workbook()
  libro.creator = "Agente Registro como Proveedor"
  for (const celda of celdas) {
    const hoja = libro.getWorksheet(celda.hoja) ?? libro.addWorksheet(celda.hoja)
    const etiqueta = hoja.getCell(celda.celda_etiqueta)
    etiqueta.value = celda.etiqueta
    etiqueta.font = { bold: true }

    const v = valorParaFormulario(mapeo, celda.etiqueta)
    const valor = hoja.getCell(celda.celda_valor)
    valor.value = v.valor
    valor.numFmt = "@"
    if (v.estado !== "lleno") {
      valor.note = `${MARCA[v.estado]} ${v.nota ?? ""}`.trim()
      valor.fill = { type: "pattern", pattern: "solid", fgColor: { argb: v.estado === "faltante" ? "FFFDE2E1" : "FFFFF4CE" } }
    }
  }
  libro.eachSheet((hoja) => {
    hoja.columns.forEach((col) => {
      col.width = 34
    })
  })
  await libro.xlsx.writeFile(destino)
  return celdas.length
}

// ── P1 · PDF: ver formulario-pdf.ts ─────────────────────────────────────────────────────────

export { generarPdf } from "./formulario-pdf.ts"

// ── P2 · Portal web (no soportado: valores listos para copiar) ───────────────────────────────

function celdaMd(texto: string): string {
  return texto.replaceAll("|", "\\|").replaceAll("\n", " ")
}

export async function generarValoresPortal(
  campos: readonly CampoSolicitado[],
  mapeo: Mapeo,
  enc: Encabezado,
  destino: string,
): Promise<number> {
  const filas = campos.map((campo) => {
    const v = valorParaFormulario(mapeo, campo.etiqueta)
    const estado = v.estado === "lleno" ? "lleno" : v.estado === "faltante" ? "**FALTANTE**" : "**REQUIERE CONFIRMACIÓN**"
    const fuente = v.estado === "lleno" ? "maestro" : (v.nota ?? "")
    return `| ${celdaMd(campo.etiqueta)} | ${celdaMd(v.valor || "—")} | ${estado} | ${celdaMd(fuente)} |`
  })
  const md = [
    `# Valores para el portal — ${enc.solicitud.cliente}`,
    "",
    `> **Formato no soportado:** el portal web no se llena automáticamente. Copia cada valor en el formulario en línea.`,
    `> Las credenciales del portal las ingresa una persona directamente en el navegador; nunca se escriben aquí, en el chat ni en los logs.`,
    "",
    `- Caso: \`${enc.caso}\``,
    `- País: ${enc.solicitud.pais}`,
    `- Generado: ${enc.fechaEjecucion}`,
    "",
    "| Campo | Valor | Estado | Fuente / nota |",
    "|---|---|---|---|",
    ...filas,
    "",
    "El clic en **Enviar** del portal es siempre humano.",
    "",
  ].join("\n")
  await writeFile(destino, md, "utf8")
  return campos.length
}
