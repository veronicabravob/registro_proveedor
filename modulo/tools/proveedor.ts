// Generado por scripts/generar-modulo.ts. Integración con otras plataformas de agentes (PRD §9.4).
// Re-exporta las MISMAS herramientas de la aplicación: no hay copias que puedan divergir.
// Cada export se registra en la plataforma de agentes como `proveedor_<export>`.
export * from "../../backend/src/tools/proveedor.ts"
export type { Tool, ToolContext, ToolResult } from "../../backend/src/tools/types.ts"
