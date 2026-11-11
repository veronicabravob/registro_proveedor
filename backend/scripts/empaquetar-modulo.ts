/**
 * Arma el paquete descargable del agente para integrarlo en otras plataformas de agentes,
 * sin depender del servidor de esta aplicación. Se construye desde las MISMAS fuentes que usa la app:
 *
 *   modulo/agent.md                              → agent.md
 *   modulo/skill/registro-proveedor/SKILL.md     → skill/registro-proveedor/SKILL.md
 *   backend/src/tools/**                         → tools/**          (implementación real, no re-export)
 *   backend/src/knowledge/reglas.json            → knowledge/reglas.json
 *   fixtures/                                    → fixtures/         (repositorio maestro y casos de ejemplo)
 *
 * Uso: npm run modulo:empaquetar  → dist/agente-registro-proveedor/
 * En GitHub, el workflow "Publicar agente" lo comprime y lo adjunta a cada release.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = fileURLToPath(new URL("../..", import.meta.url))
export const NOMBRE_PAQUETE = "agente-registro-proveedor"

export function empaquetar(destinoBase: string = join(raiz, "dist")): string {
  const destino = join(destinoBase, NOMBRE_PAQUETE)
  rmSync(destino, { recursive: true, force: true })
  mkdirSync(destino, { recursive: true })

  cpSync(join(raiz, "modulo", "agent.md"), join(destino, "agent.md"))
  cpSync(join(raiz, "modulo", "skill"), join(destino, "skill"), { recursive: true })
  cpSync(join(raiz, "backend", "src", "tools"), join(destino, "tools"), { recursive: true })
  mkdirSync(join(destino, "knowledge"))
  cpSync(join(raiz, "backend", "src", "knowledge", "reglas.json"), join(destino, "knowledge", "reglas.json"))
  cpSync(join(raiz, "fixtures"), join(destino, "fixtures"), { recursive: true })

  const backend = JSON.parse(readFileSync(join(raiz, "backend", "package.json"), "utf8")) as {
    version: string
    dependencies: Record<string, string>
  }
  const dep = (n: string): string => backend.dependencies[n] ?? "*"
  writeFileSync(
    join(destino, "package.json"),
    `${JSON.stringify(
      {
        name: NOMBRE_PAQUETE,
        version: backend.version,
        private: true,
        type: "module",
        description: "Agente Registro como Proveedor: system prompt, skill de conocimiento y herramientas tipadas con zod.",
        engines: { node: ">=22" },
        scripts: { ejemplo: "tsx ejemplo.ts" },
        dependencies: { zod: dep("zod"), exceljs: dep("exceljs"), "pdf-lib": dep("pdf-lib") },
        devDependencies: { tsx: dep("tsx") },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(destino, "ejemplo.ts"), EJEMPLO)
  cpSync(join(raiz, "modulo", "README.md"), join(destino, "README.md"))
  return destino
}

const EJEMPLO = `// Ejecuta el flujo completo de un caso llamando directamente a las herramientas, sin modelo ni servidor.
// Uso: npm install && npm run ejemplo
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos } from "./tools/proveedor.ts"
import { leerResultado, type ToolContext } from "./tools/types.ts"

// ctx.directory: carpeta que contiene fixtures/reto-01/ (datos) y donde se escribe out/ (resultados).
const ctx: ToolContext = { directory: import.meta.dirname, sessionId: "ejemplo" }
const caso = process.argv[2] ?? "ec-corp-andina"

for (const [nombre, salida] of [
  ["leer_solicitud", () => leer_solicitud.execute({ caso }, ctx)],
  ["mapear_campos", () => mapear_campos.execute({ caso, campos: [] }, ctx)],
] as const) {
  const r = leerResultado(await salida())
  console.log(nombre, r.ok ? r.data.resumen : r.error)
}
const mapeo = leerResultado(await mapear_campos.execute({ caso, campos: [] }, ctx))
if (mapeo.ok) console.log("generar_formulario", leerResultado(await generar_formulario.execute({ caso, mapeo: String(mapeo.data.mapeo_id) }, ctx)))
console.log("armar_paquete", leerResultado(await armar_paquete.execute({ caso }, ctx)))
`

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ruta = empaquetar()
  process.stdout.write(`Paquete listo en ${ruta} ${existsSync(join(ruta, "tools", "proveedor.ts")) ? "✔" : ""}\n`)
}
