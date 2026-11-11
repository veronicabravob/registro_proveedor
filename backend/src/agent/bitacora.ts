import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export interface RegistroLlamada {
  sessionId: string
  herramienta: string
  ok: boolean
  resumen: string
  duracionMs: number
  args: unknown
}

/** CA4: toda llamada a herramienta queda en out/log.jsonl. Best-effort: nunca rompe el turno. */
export class BitacoraGlobal {
  constructor(private readonly dirOut: string) {}

  registrar(r: RegistroLlamada): void {
    try {
      mkdirSync(this.dirOut, { recursive: true })
      appendFileSync(join(this.dirOut, "log.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), ...r })}\n`, "utf8")
    } catch {
      // Sin disco escribible el agente sigue funcionando; la traza queda en telemetría.
    }
  }
}
