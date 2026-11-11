import type { Configuracion } from "../config.ts"
import type { AdaptadorLlm } from "./adapter.ts"
import { AdaptadorAnthropic } from "./anthropic.ts"

/** Fábrica: el único lugar que conoce las implementaciones concretas de proveedor. */
export function crearAdaptador(config: Configuracion): AdaptadorLlm | null {
  switch (config.llm.proveedor) {
    case "anthropic":
      if (!config.llm.apiKey) return null
      return new AdaptadorAnthropic({
        apiKey: config.llm.apiKey,
        modelo: config.llm.modelo,
        maxTokens: config.llm.maxTokens,
        esfuerzo: config.llm.esfuerzo,
        timeoutMs: config.llm.timeoutMs,
        fallbacks: config.llm.fallbacks,
      })
  }
}
