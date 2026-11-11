/**
 * Genera las piezas del módulo reutilizable (PRD §9.4) desde las MISMAS fuentes que usa la app:
 *   agent/prompt.md                     → modulo/agent.md (frontmatter + system prompt)
 *   src/knowledge/registro-proveedor.md → modulo/skill/registro-proveedor/SKILL.md
 *   src/tools/proveedor.ts              → modulo/tools/proveedor.ts (re-export, no copia)
 *
 * Uso:  npm run modulo          (escribe)
 *       npm run modulo -- --check  (falla si el módulo está desactualizado; lo usa CI)
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = fileURLToPath(new URL("../..", import.meta.url))
const leer = (ruta: string): string => readFileSync(join(raiz, ruta), "utf8").trim()
const AVISO = "<!-- Generado por scripts/generar-modulo.ts. No editar a mano: edita la fuente y ejecuta `npm run modulo`. -->"

export function piezasDelModulo(): Record<string, string> {
  return {
    "modulo/agent.md": [
      "---",
      "description: Prepara formularios de registro como proveedor ante clientes y el paquete para firma del representante legal; nunca firma ni envía.",
      "mode: primary",
      "permission:",
      "  edit: deny",
      "  bash: deny",
      "---",
      "",
      AVISO,
      "",
      leer("backend/agent/prompt.md"),
      "",
    ].join("\n"),
    "modulo/skill/registro-proveedor/SKILL.md": [
      "---",
      "name: registro-proveedor",
      "description: Proceso de registro como proveedor de Periferia ante clientes de CO, EC, PE, PA y HN — identificador tributario por país, datos bancarios, soportes y vigencias, bloqueo de firma y confirmación humana. Úsala al preparar formularios de registro de proveedor o revisar un paquete para firma.",
      "---",
      "",
      AVISO,
      "",
      leer("backend/src/knowledge/registro-proveedor.md"),
      "",
    ].join("\n"),
    "modulo/tools/proveedor.ts": [
      "// Generado por scripts/generar-modulo.ts. Bonus PRD §9.4.",
      "// Re-exporta las MISMAS herramientas de la aplicación: no hay copias que puedan divergir.",
      "// Cada export se registra en la plataforma de agentes como `proveedor_<export>`.",
      'export * from "../../backend/src/tools/proveedor.ts"',
      'export type { Tool, ToolContext, ToolResult } from "../../backend/src/tools/types.ts"',
      "",
    ].join("\n"),
  }
}

function main(): void {
  const comprobar = process.argv.includes("--check")
  const desactualizadas: string[] = []
  for (const [ruta, contenido] of Object.entries(piezasDelModulo())) {
    const destino = join(raiz, ruta)
    let actual = ""
    try {
      actual = readFileSync(destino, "utf8")
    } catch {
      /* no existe aún */
    }
    if (actual.replaceAll("\r\n", "\n") === contenido) continue
    if (comprobar) desactualizadas.push(ruta)
    else writeFileSync(destino, contenido, "utf8")
  }
  if (desactualizadas.length) {
    process.stderr.write(`Módulo desactualizado: ${desactualizadas.join(", ")}. Ejecuta \`npm run modulo\`.\n`)
    process.exit(1)
  }
  process.stdout.write(comprobar ? "Módulo sincronizado con la aplicación ✔\n" : "Módulo generado ✔\n")
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
