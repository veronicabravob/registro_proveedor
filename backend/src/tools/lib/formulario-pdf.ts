import { readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import {
  type PDFDocument as Documento,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib"
import type { CampoSolicitado } from "./datos.ts"
import type { Encabezado } from "./formularios.ts"
import { type Mapeo, valorParaFormulario } from "./mapeo.ts"
import { reglas } from "./reglas.ts"

/**
 * Formulario PDF del cliente (HU-3 P1) con el diseño de docs/diseno: encabezado con logo, título y
 * destinatario, resumen del estado, campos en una grilla de 6 columnas EN EL ORDEN DE LA PLANTILLA,
 * notas para los campos por confirmar o sin dato, bloque de firma y pie paginado. Tamaño carta.
 */

// ── Tokens del diseño (px del prototipo × 0,75 = puntos) ───────────────────────────────────────
const PAGINA: [number, number] = [612, 792]
const M = { arriba: 36, lados: 42, abajo: 30 }
const ANCHO = PAGINA[0] - 2 * M.lados
const COLUMNA = (ANCHO - 5 * 18) / 6
const GUTTER = 18
const C = {
  tinta: rgb(0.067, 0.067, 0.067),
  gris: rgb(0.373, 0.373, 0.4),
  linea: rgb(0.831, 0.831, 0.847),
  pastilla: rgb(0.957, 0.957, 0.961),
  verde: rgb(0.204, 0.78, 0.482),
  ambar: rgb(0.71, 0.278, 0.031),
  notaBorde: rgb(0.914, 0.725, 0.361),
  notaFondo: rgb(1, 0.98, 0.922),
  notaTexto: rgb(0.478, 0.18, 0.055),
  punteado: rgb(0.443, 0.443, 0.478),
  blanco: rgb(1, 1, 1),
}
const URL_LOGO = new URL("../recursos/logo-periferia.png", import.meta.url)

interface Fuentes {
  normal: PDFFont
  negrita: PDFFont
  mono: PDFFont
  monoNegrita: PDFFont
}

/** Las fuentes estándar usan WinAnsi: se normaliza lo que no se puede codificar. */
function seguro(texto: string): string {
  return texto
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "·")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
}

function lineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const salida: string[] = []
  let actual = ""
  for (const palabra of seguro(texto).split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (!actual || fuente.widthOfTextAtSize(prueba, tamano) <= ancho) actual = prueba
    else {
      salida.push(actual)
      actual = palabra
    }
  }
  if (actual) salida.push(actual)
  return salida.length ? salida : [""]
}

/** Rectángulo con esquinas redondeadas como ruta SVG (origen arriba a la izquierda). */
function rectRedondeado(ancho: number, alto: number, r: number): string {
  return `M ${r} 0 H ${ancho - r} Q ${ancho} 0 ${ancho} ${r} V ${alto - r} Q ${ancho} ${alto} ${ancho - r} ${alto} H ${r} Q 0 ${alto} 0 ${alto - r} V ${r} Q 0 0 ${r} 0 Z`
}

/** Lienzo con coordenadas de arriba hacia abajo, como en el diseño. */
class Lienzo {
  constructor(
    readonly pagina: PDFPage,
    private readonly f: Fuentes,
  ) {}

  private y(arriba: number): number {
    return PAGINA[1] - arriba
  }

  texto(t: string, x: number, arriba: number, o: { tamano: number; fuente?: PDFFont; color?: ReturnType<typeof rgb> }): number {
    const fuente = o.fuente ?? this.f.normal
    const limpio = seguro(t)
    this.pagina.drawText(limpio, {
      x,
      y: this.y(arriba + o.tamano * 0.8),
      size: o.tamano,
      font: fuente,
      color: o.color ?? C.tinta,
    })
    return fuente.widthOfTextAtSize(limpio, o.tamano)
  }

  textoDerecha(
    t: string,
    xDerecho: number,
    arriba: number,
    o: { tamano: number; fuente?: PDFFont; color?: ReturnType<typeof rgb> },
  ): void {
    const fuente = o.fuente ?? this.f.normal
    this.texto(t, xDerecho - fuente.widthOfTextAtSize(seguro(t), o.tamano), arriba, o)
  }

  linea(x1: number, arriba: number, x2: number, grosor: number, color = C.linea): void {
    this.pagina.drawLine({ start: { x: x1, y: this.y(arriba) }, end: { x: x2, y: this.y(arriba) }, thickness: grosor, color })
  }

  caja(
    x: number,
    arriba: number,
    ancho: number,
    alto: number,
    o: { radio: number; fondo?: ReturnType<typeof rgb>; borde?: ReturnType<typeof rgb>; grosor?: number; punteado?: boolean },
  ): void {
    this.pagina.drawSvgPath(rectRedondeado(ancho, alto, o.radio), {
      x,
      y: this.y(arriba),
      ...(o.fondo ? { color: o.fondo } : {}),
      ...(o.borde ? { borderColor: o.borde, borderWidth: o.grosor ?? 0.75 } : {}),
      ...(o.punteado ? { borderDashArray: [3, 2] } : {}),
    })
  }

  circulo(
    x: number,
    arriba: number,
    r: number,
    o: { fondo?: ReturnType<typeof rgb>; borde?: ReturnType<typeof rgb>; grosor?: number; punteado?: boolean },
  ): void {
    this.pagina.drawCircle({
      x,
      y: this.y(arriba),
      size: r,
      ...(o.fondo ? { color: o.fondo } : {}),
      ...(o.borde ? { borderColor: o.borde, borderWidth: o.grosor ?? 0.75 } : {}),
      ...(o.punteado ? { borderDashArray: [1.5, 1.5] } : {}),
    })
  }
}

// ── Modelo de cada campo ────────────────────────────────────────────────────────────────────────

interface CampoPdf {
  numero: string
  etiqueta: string
  valor: string
  estado: "lleno" | "requiere_confirmacion" | "faltante"
  nota: string | null
  mono: boolean
  columnas: 2 | 3 | 6
}

const anchoColumnas = (n: number): number => n * COLUMNA + (n - 1) * GUTTER

function notaLegible(mapeo: Mapeo, etiqueta: string, estado: CampoPdf["estado"], paisCliente: string): string | null {
  if (estado === "faltante") return "No existe en el repositorio maestro; se deja en blanco para completar a mano."
  if (estado === "lleno") return null
  const pc = mapeo.requiere_confirmacion.find((c) => c.etiqueta === etiqueta)
  if (pc?.equivalente_pais) {
    const pais = reglas().nombres_pais[paisCliente] ?? paisCliente
    return `Es el NIT colombiano: el cliente pide ${pc.equivalente_pais} y Periferia no tiene identificador en ${pais}.`
  }
  if (pc?.motivo.startsWith("mapeo con confianza"))
    return "El dato salió de un campo parecido del maestro; verificar que corresponda."
  return pc?.motivo ?? null
}

function prepararCampos(campos: readonly CampoSolicitado[], mapeo: Mapeo, paisCliente: string, f: Fuentes): CampoPdf[] {
  return campos.map((campo, i) => {
    const v = valorParaFormulario(mapeo, campo.etiqueta)
    const etiqueta = `${campo.etiqueta}${campo.obligatorio ? " *" : ""}`
    const nota = notaLegible(mapeo, campo.etiqueta, v.estado, paisCliente)
    const mono = /^[A-Z0-9-]{6,}$/.test(v.valor) && /\d/.test(v.valor)
    const necesario = Math.max(
      f.normal.widthOfTextAtSize(seguro(etiqueta), 9) + 22,
      f.negrita.widthOfTextAtSize(seguro(v.valor), 12),
    )
    const columnas: CampoPdf["columnas"] = necesario <= anchoColumnas(2) && !nota ? 2 : necesario <= anchoColumnas(3) ? 3 : 6
    return { numero: String(i + 1).padStart(2, "0"), etiqueta, valor: v.valor, estado: v.estado, nota, mono, columnas }
  })
}

/** Agrupa los campos en filas de 6 columnas respetando el orden; el último de cada fila se estira. */
function filas(campos: readonly CampoPdf[]): { campo: CampoPdf; columnas: number }[][] {
  const resultado: { campo: CampoPdf; columnas: number }[][] = []
  let fila: { campo: CampoPdf; columnas: number }[] = []
  let usadas = 0
  const cerrar = (): void => {
    const ultima = fila.at(-1)
    if (ultima) ultima.columnas += 6 - usadas
    if (fila.length) resultado.push(fila)
    fila = []
    usadas = 0
  }
  for (const campo of campos) {
    if (usadas + campo.columnas > 6) cerrar()
    fila.push({ campo, columnas: campo.columnas })
    usadas += campo.columnas
  }
  cerrar()
  return resultado
}

function altoCelda(c: CampoPdf, ancho: number, f: Fuentes): number {
  let alto = 7 + 12
  alto += c.estado === "faltante" ? 18 + 3 : lineas(c.valor, c.mono ? f.monoNegrita : f.negrita, 12, ancho).length * 15
  if (c.nota)
    alto +=
      4 +
      lineas(c.nota, f.normal, 9, ancho - (c.estado === "requiere_confirmacion" ? 12 : 0)).length * 12 +
      (c.estado === "requiere_confirmacion" ? 8 : 0)
  return alto + 7.5
}

function dibujarCelda(l: Lienzo, c: CampoPdf, x: number, arriba: number, ancho: number, alto: number, f: Fuentes): void {
  let y = arriba + 7
  const anchoNumero = l.texto(c.numero, x, y, { tamano: 9, fuente: f.mono, color: C.gris })
  l.texto(c.etiqueta, x + anchoNumero + 5, y, { tamano: 9, color: C.gris })
  y += 12
  if (c.estado === "faltante") {
    l.caja(x, y, ancho, 18, { radio: 4.5, borde: C.punteado, punteado: true })
    y += 21
  } else {
    const fuente = c.mono ? f.monoNegrita : f.negrita
    for (const linea of lineas(c.valor, fuente, 12, ancho)) {
      l.texto(linea, x, y, { tamano: 12, fuente })
      y += 15
    }
  }
  if (c.nota) {
    y += 4
    if (c.estado === "requiere_confirmacion") {
      const contenido = lineas(`Por confirmar. ${c.nota}`, f.normal, 9, ancho - 12)
      const altoNota = contenido.length * 12 + 8
      l.caja(x, y, ancho, altoNota, { radio: 4.5, fondo: C.notaFondo, borde: C.notaBorde })
      escribirNota(l, contenido, "Por confirmar.", x + 6, y + 4, f, C.notaTexto)
    } else {
      escribirNota(l, lineas(`Sin dato. ${c.nota}`, f.normal, 9, ancho), "Sin dato.", x, y, f, C.gris)
    }
  }
  l.linea(x, arriba + alto, x + ancho, 0.75)
}

/** Escribe una nota con su primera palabra clave en negrita. */
function escribirNota(
  l: Lienzo,
  contenido: string[],
  clave: string,
  x: number,
  arriba: number,
  f: Fuentes,
  color: ReturnType<typeof rgb>,
): void {
  contenido.forEach((linea, i) => {
    const y = arriba + i * 12
    if (i === 0 && linea.startsWith(clave)) {
      const w = l.texto(clave, x, y, { tamano: 9, fuente: f.negrita, color: color === C.gris ? C.tinta : color })
      l.texto(linea.slice(clave.length), x + w, y, { tamano: 9, color })
    } else l.texto(linea, x, y, { tamano: 9, color })
  })
}

// ── Página ──────────────────────────────────────────────────────────────────────────────────────

const ALTO_FIRMA = 94
const LIMITE = PAGINA[1] - M.abajo - 24

function encabezadoPrincipal(l: Lienzo, enc: Encabezado, logo: PDFImage, f: Fuentes): number {
  const altoLogo = 33
  l.pagina.drawImage(logo, {
    x: M.lados,
    y: PAGINA[1] - M.arriba - altoLogo,
    height: altoLogo,
    width: (logo.width / logo.height) * altoLogo,
  })
  l.textoDerecha(`Caso ${enc.caso}`, PAGINA[0] - M.lados, M.arriba + 8, { tamano: 9, fuente: f.mono, color: C.gris })
  l.textoDerecha(`Generado ${enc.fechaEjecucion}`, PAGINA[0] - M.lados, M.arriba + 20, {
    tamano: 9,
    fuente: f.mono,
    color: C.gris,
  })

  let y = M.arriba + altoLogo + 15
  l.texto("Formulario de registro de proveedor", M.lados, y, { tamano: 22.5, fuente: f.negrita })
  y += 30
  const pais = reglas().nombres_pais[enc.solicitud.pais] ?? enc.solicitud.pais
  let x = M.lados
  x += l.texto("Para ", x, y, { tamano: 9.75, color: C.gris })
  x += l.texto(`${enc.solicitud.cliente} · ${pais}`, x, y, { tamano: 9.75, fuente: f.negrita }) + 21
  const referencia = enc.solicitud.asunto.split(/\s+-\s+/)[0] ?? enc.solicitud.asunto
  if (x + f.normal.widthOfTextAtSize(seguro(`Referencia ${referencia}`), 9.75) > PAGINA[0] - M.lados) {
    x = M.lados
    y += 14
  }
  x += l.texto("Referencia ", x, y, { tamano: 9.75, color: C.gris })
  l.texto(referencia, x, y, { tamano: 9.75, fuente: f.negrita })
  y += 24
  l.linea(M.lados, y, PAGINA[0] - M.lados, 1.5, C.tinta)
  return y + 15
}

function resumen(l: Lienzo, campos: readonly CampoPdf[], arriba: number, f: Fuentes): number {
  const alto = 26
  l.caja(M.lados, arriba, ANCHO, alto, { radio: 7.5, fondo: C.pastilla })
  const centro = arriba + alto / 2
  const llenos = campos.filter((c) => c.estado === "lleno").length
  const items: [string, string, (x: number) => void][] = [
    [`${llenos} de ${campos.length}`, " campos llenos", (x) => l.circulo(x, centro, 3.75, { fondo: C.verde })],
    [
      String(campos.filter((c) => c.estado === "requiere_confirmacion").length),
      " por confirmar",
      (x) => l.circulo(x, centro, 2.6, { borde: C.ambar, grosor: 2.25 }),
    ],
    [
      String(campos.filter((c) => c.estado === "faltante").length),
      " sin dato",
      (x) => l.circulo(x, centro, 3.4, { borde: C.tinta, grosor: 0.75, punteado: true }),
    ],
  ]
  let x = M.lados + 14
  for (const [cifra, texto, icono] of items) {
    icono(x)
    x += 9
    x += l.texto(cifra, x, centro - 4.5, { tamano: 9.75, fuente: f.negrita })
    x += l.texto(texto, x, centro - 4.5, { tamano: 9.75 }) + 16.5
  }
  l.textoDerecha("* obligatorio para el cliente", PAGINA[0] - M.lados - 10.5, centro - 4.5, { tamano: 9.75, color: C.gris })
  return arriba + alto + 12
}

function firma(l: Lienzo, arriba: number, firmante: Encabezado["firmante"], f: Fuentes): void {
  l.caja(M.lados, arriba, ANCHO, ALTO_FIRMA, { radio: 9, borde: C.tinta, grosor: 0.75 })
  const x1 = M.lados + 15
  const ancho1 = anchoColumnas(4) - 15
  const x2 = M.lados + anchoColumnas(4) + GUTTER
  const ancho2 = anchoColumnas(2) - 15
  const linea = arriba + 13.5 + 39
  l.linea(x1, linea, x1 + ancho1, 0.75, C.tinta)
  l.linea(x2, linea, x2 + ancho2, 0.75, C.tinta)
  l.texto("Firma del representante legal", x1, linea + 4, { tamano: 9.75, fuente: f.negrita })
  l.texto("Fecha de firma", x2, linea + 4, { tamano: 9.75, fuente: f.negrita })
  if (firmante) l.texto(`${firmante.nombre} · ${firmante.cargo}`, x1, linea + 18, { tamano: 9, color: C.gris })
  l.texto("día / mes / año", x2, linea + 18, { tamano: 9, color: C.gris })
}

function pie(l: Lienzo, numero: number, total: number, f: Fuentes): void {
  const y = PAGINA[1] - M.abajo - 9
  l.texto("Preparado por el agente de registro. Pendiente de firma; no ha sido enviado.", M.lados, y, {
    tamano: 9,
    color: C.gris,
  })
  l.textoDerecha(`Página ${numero} de ${total}`, PAGINA[0] - M.lados, y, { tamano: 9, color: C.gris, fuente: f.normal })
}

function encabezadoContinuacion(l: Lienzo, enc: Encabezado, f: Fuentes): number {
  l.texto(`Formulario de registro de proveedor · ${enc.solicitud.cliente}`, M.lados, M.arriba, { tamano: 9, color: C.gris })
  l.textoDerecha(`Caso ${enc.caso}`, PAGINA[0] - M.lados, M.arriba, { tamano: 9, fuente: f.mono, color: C.gris })
  l.linea(M.lados, M.arriba + 16, PAGINA[0] - M.lados, 0.75, C.tinta)
  return M.arriba + 26
}

async function cargarFuentes(doc: Documento): Promise<Fuentes> {
  return {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    monoNegrita: await doc.embedFont(StandardFonts.CourierBold),
  }
}

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

  const f = await cargarFuentes(doc)
  const logo = await doc.embedPng(readFileSync(URL_LOGO))
  const datos = prepararCampos(campos, mapeo, enc.solicitud.pais, f)

  let l = new Lienzo(doc.addPage(PAGINA), f)
  let y = resumen(l, datos, encabezadoPrincipal(l, enc, logo, f), f)
  for (const fila of filas(datos)) {
    const anchos = fila.map((c) => anchoColumnas(c.columnas))
    const alto = Math.max(...fila.map((c, i) => altoCelda(c.campo, anchos[i] ?? ANCHO, f)))
    if (y + alto > LIMITE) {
      l = new Lienzo(doc.addPage(PAGINA), f)
      y = encabezadoContinuacion(l, enc, f)
    }
    let x = M.lados
    fila.forEach((c, i) => {
      const ancho = anchos[i] ?? ANCHO
      dibujarCelda(l, c.campo, x, y, ancho, alto, f)
      x += ancho + GUTTER
    })
    y += alto
  }

  // El bloque de firma va al final de la última página; si no cabe, pasa a una página nueva.
  const yFirma = LIMITE - 12 - ALTO_FIRMA
  if (y + 15 > yFirma) {
    l = new Lienzo(doc.addPage(PAGINA), f)
    encabezadoContinuacion(l, enc, f)
  }
  firma(l, yFirma, enc.firmante, f)

  const paginas = doc.getPages()
  for (const [i, p] of paginas.entries()) pie(new Lienzo(p, f), i + 1, paginas.length, f)
  await writeFile(destino, await doc.save())
  return campos.length
}
