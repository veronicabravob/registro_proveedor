import { z } from "zod"
import { fail, type ToolContext } from "./types.ts"

// Cada export se expone al modelo como `proveedor_<export>` (PRD §6.2).
// TODO: implementar lógica. Por ahora solo se fija el contrato.

export const leer_solicitud = {
  description: "Lee la solicitud del cliente y su plantilla: país, cliente, formato, campos y soportes exigidos.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  },
  async execute(_args: { caso: string }, _ctx: ToolContext): Promise<string> {
    return fail("no implementado")
  },
}

export const mapear_campos = {
  description: "Cruza los campos solicitados con el maestro y los clasifica en llenos, faltantes o requiere_confirmacion.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    campos: z.array(z.string()).describe("Etiquetas de campos tal como aparecen en la plantilla"),
  },
  async execute(_args: { caso: string; campos: string[] }, _ctx: ToolContext): Promise<string> {
    return fail("no implementado")
  },
}

export const generar_formulario = {
  description: "Genera el formulario lleno en el formato pedido (xlsx, pdf o valores para portal) dentro de out/<caso>/.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    mapeo: z.unknown().describe("Resultado de proveedor_mapear_campos"),
  },
  async execute(_args: { caso: string; mapeo: unknown }, _ctx: ToolContext): Promise<string> {
    return fail("no implementado")
  },
}

export const armar_paquete = {
  description: "Arma out/<caso>/paquete/ con formulario, soportes, checklist y borrador de correo, e indica si está listo para firma.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
  },
  async execute(_args: { caso: string }, _ctx: ToolContext): Promise<string> {
    return fail("no implementado")
  },
}

export const simular_envio = {
  description: "Simula el envío escribiendo out/<caso>/ENVIO-SIMULADO.md; solo procede con confirmación explícita del usuario.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    confirmado: z.boolean().describe("true solo si el usuario confirmó explícitamente en su último mensaje"),
  },
  async execute(_args: { caso: string; confirmado: boolean }, _ctx: ToolContext): Promise<string> {
    return fail("no implementado")
  },
}
