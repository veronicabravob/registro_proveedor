import type { Solicitud, SoporteIndice } from "./datos.ts"
import type { Mapeo } from "./mapeo.ts"
import { nombreSoporte } from "./reglas.ts"

export type EstadoSoporte = "presente" | "vencido" | "ausente"

export interface SoporteEvaluado {
  tipo: string
  nombre: string
  estado: EstadoSoporte
  archivo: string | null
  vigencia_hasta: string | null
  pais_emisor: string | null
}

/** RN3: vencido si `vigencia_hasta` es anterior a la fecha de ejecución; ausente si no está en el repositorio. */
export function evaluarSoportes(exigidos: readonly string[], indice: readonly SoporteIndice[], fecha: string): SoporteEvaluado[] {
  return exigidos.map((tipo) => {
    const s = indice.find((i) => i.tipo === tipo)
    if (!s)
      return { tipo, nombre: nombreSoporte(tipo), estado: "ausente", archivo: null, vigencia_hasta: null, pais_emisor: null }
    const vencido = s.vigencia_hasta !== null && s.vigencia_hasta < fecha
    return {
      tipo,
      nombre: nombreSoporte(tipo),
      estado: vencido ? "vencido" : "presente",
      archivo: s.archivo,
      vigencia_hasta: s.vigencia_hasta,
      pais_emisor: s.pais_emisor,
    }
  })
}

export function bloqueosDeFirma(
  soportes: readonly SoporteEvaluado[],
  formulario: string | null,
  errorPlantilla: string | null,
): string[] {
  const bloqueos: string[] = []
  if (!formulario) bloqueos.push(errorPlantilla ? `Formulario no generado: ${errorPlantilla}` : "Formulario no generado")
  for (const s of soportes) {
    if (s.estado === "vencido") bloqueos.push(`Soporte vencido: ${s.nombre} (vigente hasta ${s.vigencia_hasta})`)
    if (s.estado === "ausente") bloqueos.push(`Soporte exigido ausente: ${s.nombre}`)
  }
  return bloqueos
}

const ICONO: Record<EstadoSoporte, string> = { presente: "✅ presente", vencido: "⛔ vencido", ausente: "❌ ausente" }

export function checklistMd(p: {
  caso: string
  solicitud: Solicitud
  fecha: string
  formulario: string | null
  soportes: readonly SoporteEvaluado[]
  mapeo: Mapeo | null
  bloqueos: readonly string[]
  paisMaestro: string
}): string {
  const listo = p.bloqueos.length === 0
  const lineas = [
    `# Checklist del paquete para firma — ${p.solicitud.cliente}`,
    "",
    `- Caso: \`${p.caso}\` · País del cliente: ${p.solicitud.pais} · Formato: ${p.solicitud.formato}`,
    `- Fecha de evaluación: ${p.fecha}`,
    `- **Estado: ${listo ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"}**`,
    "",
  ]
  if (!listo) lineas.push("## Bloqueos", "", ...p.bloqueos.map((b) => `- [ ] ${b}`), "")

  lineas.push(
    "## Formulario",
    "",
    p.formulario ? `- [x] \`${p.formulario}\`` : "- [ ] Formulario no generado",
    "",
    "## Soportes exigidos",
    "",
    "| Soporte | Estado | Archivo | Vigente hasta | Emisor |",
    "|---|---|---|---|---|",
    ...p.soportes.map(
      (s) =>
        `| ${s.nombre} | ${ICONO[s.estado]} | ${s.archivo ?? "—"} | ${s.vigencia_hasta ?? "no aplica"} | ${s.pais_emisor ?? "—"} |`,
    ),
    "",
  )
  const extranjeros = p.soportes.filter((s) => s.pais_emisor && s.pais_emisor !== p.solicitud.pais && s.estado !== "ausente")
  if (extranjeros.length && p.solicitud.pais !== p.paisMaestro) {
    lineas.push(
      `> Nota: los soportes son emitidos en ${p.paisMaestro}; el cliente es de ${p.solicitud.pais}. Verificar si los acepta.`,
      "",
    )
  }

  if (p.mapeo) {
    lineas.push("## Campos faltantes (no bloquean la firma)", "")
    lineas.push(
      ...(p.mapeo.faltantes.length ? p.mapeo.faltantes.map((f) => `- [ ] ${f.etiqueta} — ${f.motivo}`) : ["- Ninguno"]),
      "",
    )
    lineas.push("## Campos que requieren confirmación (no bloquean la firma)", "")
    lineas.push(
      ...(p.mapeo.requiere_confirmacion.length
        ? p.mapeo.requiere_confirmacion.map((c) => `- [ ] ${c.etiqueta} — ${c.motivo}`)
        : ["- Ninguno"]),
      "",
    )
  }
  lineas.push(
    "## Cierre humano",
    "",
    "- [ ] Revisión de la analista",
    "- [ ] Firma del representante legal",
    "- [ ] Envío al cliente",
    "",
  )
  return lineas.join("\n")
}

/** Borrador de respuesta al cliente. RN2: nunca incluye datos bancarios. */
export function borradorCorreoMd(p: {
  solicitud: Solicitud
  razonSocial: string
  adjuntos: readonly string[]
  listo: boolean
}): string {
  return [
    "<!-- BORRADOR generado por el agente. Revisar antes de enviar. No contiene datos bancarios (RN2). -->",
    p.listo ? "" : "<!-- ATENCIÓN: el paquete NO está listo para firma; ver checklist.md antes de enviar. -->",
    "",
    `**Para:** ${p.solicitud.de}`,
    `**Asunto:** RE: ${p.solicitud.asunto}`,
    "",
    "Estimados,",
    "",
    `Reciban un cordial saludo de ${p.razonSocial}. En respuesta a su solicitud de registro como proveedor, ` +
      "adjuntamos el formulario diligenciado y firmado por nuestro representante legal, junto con los siguientes soportes:",
    "",
    ...p.adjuntos.map((a) => `- ${a}`),
    "",
    "Quedamos atentos a cualquier información adicional que requieran.",
    "",
    "Cordialmente,",
    "",
    "Área Administrativa",
    p.razonSocial,
    "",
  ].join("\n")
}
