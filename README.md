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
npm run demo                               # o: bun install && bun run demo.ts
FECHA_EJECUCION=2026-09-03 npm run demo    # con la fecha del PRD
```

`demo.ts` (PRD §6.6) ejecuta los mismos pasos del agente llamando directamente a las herramientas,
**sin modelo de lenguaje ni ninguna clave**. Corre en la terminal y en el CI, no en la interfaz:

| Qué demuestra            | Cómo                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Flujo completo por caso  | Para los 4 casos de `fixtures/reto-01/casos/`: leer solicitud → mapear campos → generar formulario → armar paquete      |
| Lo que falta, explícito  | Imprime faltantes, campos que requieren confirmación y bloqueos de firma de cada caso                                 |
| Robustez (HU-5)          | Un caso inexistente y una ruta no permitida (`../etc`) devuelven `{ ok: false, error }` claro, sin excepción           |
| Confirmación humana (RN4)| El envío sin aprobación del host se rechaza; con aprobación escribe solo `out/<caso>/ENVIO-SIMULADO.md`               |
| Determinismo             | Borra `out/` al inicio y fija la fecha con `FECHA_EJECUCION`: con la misma fecha, el mismo resultado (salvo timestamps) |

Termina con una tabla por caso: formato, si quedó listo para firma y número de faltantes.

**Sobre la fecha.** La Cámara de Comercio del repositorio vence el 2026-09-30 y la exigen los 4
casos. Con la fecha actual ningún paquete queda listo para firma, y es el comportamiento correcto
(RN3). Con `FECHA_EJECUCION=2026-09-03`, la fecha del PRD, `co-industrias-delta` queda **listo
para firma**, `ec-corp-andina` se bloquea por un soporte ausente y `hn-agroexport-sula` por los
parafiscales vencidos.

El CI ejecuta `demo.ts` sin claves en cada rama y falla si falta algún formulario o checklist.

## Scripts

| Script                               | Qué hace                                                         |
| ------------------------------------ | ---------------------------------------------------------------- |
| `npm run dev`                        | Backend y front en modo desarrollo (Vite con proxy a la API)     |
| `npm run build` / `npm start`        | Compila el front y arranca el servidor de producción             |
| `npm run demo`                       | Herramientas sin modelo (PRD §6.6)                               |
| `npm test` / `npm run test:coverage` | Pruebas (`node:test`) / con umbrales de cobertura                |
| `npm run lint` / `npm run format`    | Biome: lint y formato                                            |
| `npm run typecheck`                  | TypeScript estricto, sin `any`                                   |
| `npm run modulo` / `modulo:check`    | Genera / verifica las piezas del agente para otras plataformas   |
| `npm run modulo:empaquetar`          | Arma el paquete descargable en `dist/agente-registro-proveedor/` |

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
modulo/                          agente para otras plataformas (prompt, skill, herramientas)
fixtures/reto-01/                entregados por Periferia (no modificar)
docs/                            PRD y prototipo de diseño del front
demo.ts                          verificación sin modelo
render.yaml                      despliegue como código (Render Blueprint)
```

El front habla con el backend por `/api`: en desarrollo, Vite reenvía `/api` al puerto 3000; en
producción, el backend sirve `frontend/dist` desde el mismo origen (sin CORS, con CSP estricta).
El chat usa `POST /api/chat/stream` para mostrar cada paso del agente en vivo.

## Observabilidad (Langfuse)

Cada turno del agente se traza en Langfuse vía OpenTelemetry: el turno, cada herramienta y cada
llamada al modelo con sus tokens y latencias, agrupados por conversación. Basta definir
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` y `LANGFUSE_BASE_URL`. Los datos sensibles se
enmascaran antes de exportar. Detalle en [`SOLUCION.md`](SOLUCION.md#11-observabilidad-con-langfuse).

Trace de ejemplo (procesar un caso de punta a punta): [abrir en Langfuse](https://us.cloud.langfuse.com/project/cmwbfksbk04w7ad0efkeyfx6f/traces/768206b4bc320d349c148ead86a2294d).

## Integración con otras plataformas de agentes

El agente se puede usar sin este servidor: descarga
[`agente-registro-proveedor.zip`](https://github.com/veronicabravob/registro_proveedor/releases/latest/download/agente-registro-proveedor.zip)
(o `npm run modulo:empaquetar`) y sigue la guía de [`modulo/README.md`](modulo/README.md).

## Flujo de trabajo y quality gates

- Una rama por funcionalidad (`feature/*`, `ci/*`, `deploy/*`, `docs/*`), commits convencionales y
  merge `--no-ff` a `main` **solo con CI en verde**.
- Cada push corre: Biome, `tsc` estricto, pruebas con cobertura mínima (85 % líneas, 75 % ramas),
  `demo.ts` sin claves, verificación del módulo, `npm audit` y gitleaks. CodeQL en `main` y PR;
  dependency review y Dependabot semanales.
- Detalle de cada control en [`SOLUCION.md`](SOLUCION.md#13-quality-gates-en-github).
- Ruleset de protección de `main` versionado en `.github/rulesets/main.json`.
