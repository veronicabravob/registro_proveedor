# registro_proveedor

Agente conversacional **"Registro como Proveedor"** — Reto técnico 01, Periferia IT Group.
Especificación en [`docs/PRD.md`](docs/PRD.md); planteamiento de la solución en [`SOLUCION.md`](SOLUCION.md).

## Estructura

```
agent/prompt.md            system prompt (comportamiento)
src/knowledge/             conocimiento del proceso (reglas de negocio)
src/tools/                 herramientas tipadas con zod (ejecución)
src/llm/                   adaptador del proveedor LLM
src/server.ts              API HTTP + ciclo del agente
web/                       front de chat
fixtures/reto-01/          entregados por Periferia (no modificar)
out/                       generado en ejecución (ignorado por git)
demo.ts                    herramientas sin modelo
modulo/                    bonus: agente empaquetado reutilizable
```

## Requisitos

Node 20+ (o Bun).

## Uso

```bash
cp .env.example .env    # completar LLM_PROVIDER, LLM_MODEL, LLM_API_KEY
npm install
npm run dev             # front + backend en local
npm run demo            # herramientas sin modelo (equivale a: bun run demo.ts)
```

## Variables de entorno

Ver [`.env.example`](.env.example). La clave del modelo solo vive en el entorno del backend.

## Link de prueba

_Pendiente._
