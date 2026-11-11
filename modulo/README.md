# Módulo reutilizable — Agente "Registro como Proveedor"

Empaqueta el agente para integrarlo en otras plataformas de agentes **sin depender del servidor**
de esta aplicación (PRD §9.4).

| Pieza | Qué es | Fuente única en la app |
|---|---|---|
| `agent.md` | Definición del agente: frontmatter (`description`, `mode: primary`, `permission { edit: deny, bash: deny }`) y el system prompt | `agent/prompt.md` |
| `tools/proveedor.ts` | Las herramientas tipadas con zod (`description`, `args`, `execute`) | `src/tools/proveedor.ts` (re-export) |
| `skill/registro-proveedor/SKILL.md` | El conocimiento del proceso como skill (`name`, `description`) | `src/knowledge/registro-proveedor.md` |

## Garantía de que no divergen

- `tools/proveedor.ts` **no es una copia**: re-exporta el mismo módulo que usa el servidor.
- `agent.md` y `SKILL.md` se **generan** con `npm run modulo` desde las fuentes de la app.
- `npm run modulo:check` corre en CI y en las pruebas: si alguien edita la fuente y no regenera, el build falla.

## Integración

1. Copia la carpeta `modulo/` (y `src/tools/`, `src/knowledge/reglas.json`, `fixtures/`) a la plataforma.
2. Registra `agent.md` como agente primario. Sus permisos niegan editar archivos y ejecutar comandos:
   el agente solo actúa a través de sus herramientas.
3. Registra cada export de `tools/proveedor.ts` como herramienta `proveedor_<export>` y pasa en
   `execute(args, ctx)` un `ctx.directory` que apunte a la raíz donde están `fixtures/` y `out/`.
4. Carga `skill/registro-proveedor/SKILL.md` como skill del agente.

### Confirmación humana fuera de esta app

`proveedor_simular_envio` exige siempre `confirmado: true`. Si el host además pasa
`ctx.confirmaciones` (conjunto `accion:caso` aprobado por una persona), la herramienta valida esa
aprobación. Las plataformas con su propio sistema de permisos deben marcar esta herramienta como
"requiere aprobación" (p. ej. `permission: ask`).
