import { writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib"
import type { CampoSolicitado, CeldaPlantilla, Solicitud } from "./datos.ts"
import { type Mapeo, valorParaFormulario } from "./mapeo.ts"

export interface Encabezado {
  caso: string
  solicitud: Solicitud
  fechaEjecucion: string
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

// ── P1 · PDF ─────────────────────────────────────────────────────────────────────────────────

/** Las fuentes estándar de PDF usan WinAnsi: se sustituye lo que no se puede codificar. */
function seguroWinAnsi(texto: string): string {
  return texto
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
}

function partirEnLineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of texto.split(/\s+/)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(prueba, tamano) <= ancho || !actual) actual = prueba
    else {
      lineas.push(actual)
      actual = palabra
    }
  }
  if (actual) lineas.push(actual)
  return lineas.length ? lineas : [""]
}

class EscritorPdf {
  private pagina: PDFPage
  private y = 0
  static readonly MARGEN = 56
  static readonly ANCHO_A4: [number, number] = [595.28, 841.89]

  constructor(
    private readonly doc: PDFDocument,
    private readonly normal: PDFFont,
    private readonly negrita: PDFFont,
  ) {
    this.pagina = this.nuevaPagina()
  }

  private nuevaPagina(): PDFPage {
    const p = this.doc.addPage(EscritorPdf.ANCHO_A4)
    this.y = p.getHeight() - EscritorPdf.MARGEN
    this.pagina = p
    return p
  }

  private get ancho(): number {
    return this.pagina.getWidth() - 2 * EscritorPdf.MARGEN
  }

  texto(
    texto: string,
    opciones: { tamano?: number; negrita?: boolean; color?: [number, number, number]; espacio?: number } = {},
  ): void {
    const tamano = opciones.tamano ?? 10
    const fuente = opciones.negrita ? this.negrita : this.normal
    const [r, g, b] = opciones.color ?? [0.1, 0.1, 0.12]
    for (const linea of partirEnLineas(seguroWinAnsi(texto), fuente, tamano, this.ancho)) {
      if (this.y < EscritorPdf.MARGEN + tamano) this.nuevaPagina()
      this.y -= tamano * 1.35
      this.pagina.drawText(linea, { x: EscritorPdf.MARGEN, y: this.y, size: tamano, font: fuente, color: rgb(r, g, b) })
    }
    this.y -= opciones.espacio ?? 0
  }

  separador(): void {
    this.y -= 6
    this.pagina.drawLine({
      start: { x: EscritorPdf.MARGEN, y: this.y },
      end: { x: this.pagina.getWidth() - EscritorPdf.MARGEN, y: this.y },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.78),
    })
    this.y -= 8
  }
}

/** PDF generado que reproduce todos los campos, con etiqueta y valor, en el orden de la plantilla (HU-3 P1). */
export async function generarPdf(
  campos: readonly CampoSolicitado[],
  mapeo: Mapeo,
  enc: Encabezado,
  destino: string,
): Promise<number> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Formulario de registro de proveedor - ${enc.solicitud.cliente}`)
  doc.setAuthor("Periferia IT Group S.A.S.")
  doc.setCreator("Agente Registro como Proveedor")
  doc.setProducer("pdf-lib")
  doc.setCreationDate(new Date(`${enc.fechaEjecucion}T00:00:00Z`))
  doc.setModificationDate(new Date(`${enc.fechaEjecucion}T00:00:00Z`))

  const w = new EscritorPdf(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold))
  w.texto("Formulario de registro de proveedor", { tamano: 16, negrita: true, espacio: 4 })
  w.texto(`Cliente: ${enc.solicitud.cliente} (${enc.solicitud.pais})`, { tamano: 10 })
  w.texto(`Referencia: ${enc.solicitud.asunto}`, { tamano: 10 })
  w.texto(`Caso: ${enc.caso} · Generado: ${enc.fechaEjecucion}`, { tamano: 9, color: [0.4, 0.4, 0.45] })
  w.separador()

  campos.forEach((campo, i) => {
    const v = valorParaFormulario(mapeo, campo.etiqueta)
    const obligatorio = campo.obligatorio ? " *" : ""
    w.texto(`${i + 1}. ${campo.etiqueta}${obligatorio}`, { tamano: 9, negrita: true, color: [0.3, 0.3, 0.35] })
    if (v.estado === "faltante") w.texto(`${MARCA.faltante} ${v.nota}`, { tamano: 11, color: [0.7, 0.1, 0.1], espacio: 6 })
    else if (v.estado === "requiere_confirmacion") {
      w.texto(v.valor, { tamano: 11 })
      w.texto(`${MARCA.requiere_confirmacion} ${v.nota ?? ""}`, { tamano: 8, color: [0.6, 0.4, 0], espacio: 6 })
    } else w.texto(v.valor, { tamano: 11, espacio: 6 })
  })

  w.separador()
  w.texto("* Campo obligatorio para el cliente.", { tamano: 8, color: [0.4, 0.4, 0.45] })
  w.texto("Firma del representante legal: ______________________________", { tamano: 10, espacio: 4 })
  await writeFile(destino, await doc.save())
  return campos.length
}

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
