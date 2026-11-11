/** Interfaz del proveedor LLM. Cambiar de proveedor no toca el ciclo del agente (PRD §6.1). */

export type Role = "user" | "assistant" | "tool"

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface Message {
  role: Role
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema derivado del esquema zod. */
  parameters: Record<string, unknown>
}

export interface LlmResponse {
  text: string
  toolCalls: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
}

export interface LlmAdapter {
  readonly provider: string
  readonly model: string
  enviar(system: string, mensajes: Message[], herramientas: ToolSpec[]): Promise<LlmResponse>
}
