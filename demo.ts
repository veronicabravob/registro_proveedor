/**
 * Verificación sin modelo (PRD §6.6): ejecuta todos los casos de fixtures/reto-01/casos/
 * llamando directamente a las herramientas, e imprime un resumen por caso.
 * No necesita clave de ningún proveedor.  Uso:  npm run demo   (o: bun run demo.ts)
 */
import { rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { listarCasos } from "./src/tools/lib/rutas.ts"
import * as proveedor from "./src/tools/proveedor.ts"
import { leerResultado, type ToolContext } from "./src/tools/types.ts"

const raiz = fileURLToPath(new URL(".", import.meta.url))
const ctx: ToolContext = { directory: raiz, sessionId: "demo", ...(process.env.FECHA_EJECUCION ? { fechaEjecucion: process.env.FECHA_EJECUCION } : {}) }

type Datos = Record<string, unknown>

async function paso(nombre: string, salida: Promise<string>): Promise<Datos | null> {
  const r = leerResultado(await salida)
  if (r.ok) {
    console.log(`  ✔ ${nombre.padEnd(22)} ${String(r.data.resumen ?? "")}`)
    return r.data
  }
  console.log(`  ✘ ${nombre.padEnd(22)} ${r.error}`)
  return null
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as Datos).etiqueta ?? x))) : [])

async function procesar(caso: string): Promise<{ caso: string; formato: string; listo: string; faltantes: number }> {
  console.log(`\n▶ ${caso}`)
  const solicitud = await paso("leer_solicitud", proveedor.leer_solicitud.execute({ caso }, ctx))
  const mapeo = await paso("mapear_campos", proveedor.mapear_campos.execute({ caso, campos: [] }, ctx))
  if (mapeo) {
    console.log(`      faltantes: ${lista(mapeo.faltantes).join(", ") || "ninguno"}`)
    console.log(`      requieren confirmación: ${lista(mapeo.requiere_confirmacion).join(", ") || "ninguno"}`)
    await paso("generar_formulario", proveedor.generar_formulario.execute({ caso, mapeo: String(mapeo.mapeo_id) }, ctx))
  }
  const paquete = await paso("armar_paquete", proveedor.armar_paquete.execute({ caso }, ctx))
  for (const b of lista(paquete?.bloqueos)) console.log(`      bloqueo: ${b}`)

  // RN4: sin aprobación humana registrada por el host, el envío se rechaza.
  await paso("simular_envio (sin OK)", proveedor.simular_envio.execute({ caso, confirmado: true }, { ...ctx, confirmaciones: new Set() }))

  return {
    caso,
    formato: String(solicitud?.formato ?? "?"),
    listo: paquete ? (paquete.listo_para_firma ? "sí" : "no") : "error",
    faltantes: lista(mapeo?.faltantes).length,
  }
}

async function main(): Promise<void> {
  rmSync(join(raiz, "out"), { recursive: true, force: true }) // determinismo: out/ se limpia al inicio
  console.log(`Demo de herramientas · fecha de ejecución ${ctx.fechaEjecucion ?? "hoy"}`)

  const resumen = []
  for (const caso of listarCasos(ctx)) resumen.push(await procesar(caso))

  console.log("\n▶ Errores controlados (HU-5)")
  await paso("caso inexistente", proveedor.leer_solicitud.execute({ caso: "no-existe" }, ctx))
  await paso("argumento inválido", proveedor.leer_solicitud.execute({ caso: "../etc" }, ctx))

  const primero = resumen[0]?.caso
  if (primero) {
    console.log("\n▶ Envío con aprobación humana registrada por el host")
    await paso("simular_envio (con OK)", proveedor.simular_envio.execute({ caso: primero, confirmado: true }, { ...ctx, confirmaciones: new Set([`simular_envio:${primero}`]) }))
  }

  console.log("\nResumen")
  console.table(resumen)
}

await main()
