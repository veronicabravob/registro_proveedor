# Registro como Proveedor — agente conversacional

[![CI](https://github.com/veronicabravob/registro_proveedor/actions/workflows/ci.yml/badge.svg)](https://github.com/veronicabravob/registro_proveedor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/veronicabravob/registro_proveedor/actions/workflows/codeql.yml/badge.svg)](https://github.com/veronicabravob/registro_proveedor/actions/workflows/codeql.yml)

Agente que, a partir de una solicitud de un cliente, **identifica los campos pedidos, los llena desde
el repositorio maestro, genera el formulario en el formato del cliente (Excel, PDF o valores para
portal) y arma el paquete para la firma del representante legal**. Nunca firma ni envía: prepara y
pide confirmación humana.

Reto técnico 01 · Periferia IT Group. Especificación en [`docs/PRD.md`](docs/PRD.md) · planteamiento en [`SOLUCION.md`](SOLUCION.md).

## Link de prueba

|                     |                                                                                |
| ------------------- | ------------------------------------------------------------------------------ |
| **URL**             | https://registro-proveedor-fl6d.onrender.com                                   |
| **Clave de acceso** | Se entrega por separado al equipo evaluador (el front la pide la primera vez). |

> Plan gratuito de Render: si el servicio estuvo inactivo, la primera carga tarda ~1 minuto en despertar.

Prueba sugerida (PRD §11), en una sesión nueva:

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete
está listo para firma y qué soportes debo actualizar. No envíes nada todavía.
```

O simplemente elige la tarjeta **Corporación Andina** en la pantalla de inicio. Luego escribe `envía`:
el agente pide confirmación (tarjeta verde con botones) y solo tras un "sí" explícito registra el
envío simulado (`out/ec-corp-andina/ENVIO-SIMULADO.md`).

## Levantar en local (un comando)

Requisitos: **Node 22+** (o Bun).

```bash
cp .env.example .env      # poner ANTHROPIC_API_KEY
npm install
npm run dev               # backend :3000 + front :5173 → abrir http://localhost:5173
```

Como en producción (un solo servidor que sirve el front compilado):

```bash
npm run build && npm start   # http://localhost:3000
```

Con Bun: `bun install && bun run demo.ts` (verificación) y `bun run backend/src/server.ts` (servidor).

## Verificación sin modelo

```bash
npm run demo              # o: bun install && bun run demo.ts
```

Limpia `out/`, ejecuta los 4 casos de `fixtures/reto-01/casos/` llamando directamente a las
herramientas e imprime un resumen por caso. No necesita ninguna clave.

## Scripts

| Script                               | Qué hace                                                     |
| ------------------------------------ | ------------------------------------------------------------ |
| `npm run dev`                        | Backend y front en modo desarrollo (Vite con proxy a la API) |
| `npm run build` / `npm start`        | Compila el front y arranca el servidor de producción         |
| `npm run demo`                       | Herramientas sin modelo (PRD §6.6)                           |
| `npm test` / `npm run test:coverage` | Pruebas (`node:test`) / con umbrales de cobertura            |
| `npm run lint` / `npm run format`    | Biome: lint y formato                                        |
| `npm run typecheck`                  | TypeScript estricto, sin `any`                               |
| `npm run modulo` / `modulo:check`    | Genera / verifica el módulo reutilizable (`modulo/`)         |

## Variables de entorno

Todas documentadas en [`.env.example`](.env.example). Las principales:

| Variable                                             | Obligatoria       | Descripción                                                                                       |
| ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                  | Sí (para el chat) | Clave del modelo. Solo en el entorno del backend; nunca en el repo, el front, los logs ni la API. |
| `LLM_MODEL`                                          | No                | Por defecto `claude-opus-5-5`.                                                                    |
| `LLM_EFFORT`                                         | No                | `low` · `medium` (defecto) · `high`…                                                              |
| `APP_ACCESS_KEY`                                     | No                | Si se define, la API y el front exigen esta clave.                                                |
| `MAX_ITERATIONS_PER_TURN` / `MAX_TOKENS_PER_SESSION` | No                | Topes de costo por turno y por sesión.                                                            |
| `RATE_LIMIT_PER_MINUTE`                              | No                | Solicitudes de chat por IP y minuto.                                                              |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`        | No                | Trazas del agente en Langfuse (OpenTelemetry).                                                    |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                        | No                | Trazas y métricas a cualquier backend OTLP/HTTP.                                                  |

## API

| Método | Ruta                    | Cuerpo / respuesta                                                                                                        |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/chat/stream`      | Igual que `/api/chat`, pero emite el avance en vivo (SSE: `paso_inicio`, `paso_fin`, `respuesta`)                         |
| `POST` | `/api/chat`             | `{ sessionId?, message, confirm? }` → `{ sessionId, reply, toolCalls[], needsConfirmation, pendingAction, error, usage }` |
| `GET`  | `/api/sessions/:id`     | Historial completo visible de la sesión                                                                                   |
| `GET`  | `/api/health`           | `{ ok: true, provider, model, ... }` sin exponer claves                                                                   |
| `GET`  | `/api/casos`            | Casos disponibles con cliente, país y formato                                                                             |
| `GET`  | `/api/archivos/out/...` | Descarga de archivos generados (solo dentro de `out/`)                                                                    |

Si hay `APP_ACCESS_KEY`, todas las rutas salvo `/api/health` requieren el header `x-access-key`.

```bash
curl -s https://registro-proveedor-fl6d.onrender.com/api/chat \
  -H "Content-Type: application/json" -H "x-access-key: <CLAVE_DE_ACCESO>" \
  -d '{"message":"Procesa el caso co-industrias-delta"}'
```

## Estructura (monorepo con npm workspaces)

```
backend/                         API, agente, herramientas y telemetría (Node + TypeScript)
  agent/prompt.md                comportamiento (system prompt)
  src/knowledge/                 conocimiento: proceso (md) y reglas de negocio (json)
  src/tools/                     ejecución: herramientas zod → proveedor_<export>
  src/agent/                     ciclo del agente, sesiones, confirmación humana
  src/llm/                       interfaz de proveedor + implementación Anthropic
  src/telemetry/                 OpenTelemetry → Langfuse / OTLP, métricas, enmascarado
  src/http/                      API Hono (JSON y streaming SSE) y seguridad
  test/                          pruebas de herramientas, ciclo, API, telemetría y módulo
frontend/                        chat de la analista (React + Vite + TypeScript)
  src/api/                       cliente tipado de la API y lector de streaming
  src/dominio/                   pasos en lenguaje de negocio, progreso, archivos (con pruebas)
  src/hooks/useAgente.ts         estado de la conversación
  src/componentes/               bienvenida, pasos, respuesta, confirmación, marco
modulo/                          bonus: agente empaquetado reutilizable
fixtures/reto-01/                entregados por Periferia (no modificar)
docs/                            PRD y prototipo de diseño del front
demo.ts                          verificación sin modelo
render.yaml                      despliegue como código (Render Blueprint)
```

El front habla con el backend por `/api`: en desarrollo, Vite reenvía `/api` al puerto 3000; en
producción, el backend sirve `frontend/dist` desde el mismo origen (sin CORS, con CSP estricta).
El chat usa `POST /api/chat/stream` para mostrar cada paso del agente en vivo.

## Flujo de trabajo y quality gates

- Una rama por funcionalidad (`feature/*`, `ci/*`, `deploy/*`, `docs/*`), commits convencionales y
  merge `--no-ff` a `main` **solo con CI en verde**.
- Cada push corre: Biome, `tsc` estricto, pruebas con cobertura mínima (85 % líneas, 75 % ramas),
  `demo.ts` sin claves, verificación del módulo, `npm audit` y gitleaks. CodeQL en `main` y PR;
  dependency review y Dependabot semanales.
- Ruleset de protección de `main` versionado en `.github/rulesets/main.json`.
