# Agente "Registro como Proveedor" — integración con otras plataformas de agentes

Este paquete contiene el agente listo para usarse **en cualquier plataforma de agentes, sin depender
del servidor de esta aplicación**: el system prompt, el conocimiento del proceso como *skill* y las
herramientas tipadas con zod.

## 1. Descargar

| Opción | Cómo |
|---|---|
| **Release (recomendado)** | [`agente-registro-proveedor.zip`](https://github.com/veronicabravob/registro_proveedor/releases/latest/download/agente-registro-proveedor.zip): enlace estable que siempre apunta a la última release. |
| Una versión concreta | Elegirla en [Releases](https://github.com/veronicabravob/registro_proveedor/releases); cada tag `v*` publica su propio `.zip`. |
| Desde el código | Clonar el repositorio y ejecutar `npm install && npm run modulo:empaquetar`; el paquete queda en `dist/agente-registro-proveedor/`. |

El `.zip` de cada release lo arma el workflow `publicar-agente.yml` desde las mismas fuentes que la
app, y lo instala y prueba de forma aislada antes de adjuntarlo (ver sección 5).

## 2. Contenido

```
agente-registro-proveedor/
├── agent.md                          definición del agente: frontmatter + system prompt
├── skill/registro-proveedor/SKILL.md conocimiento del proceso (reglas por país, soportes, firma)
├── tools/proveedor.ts                las herramientas (cada export → proveedor_<export>)
├── tools/types.ts, tools/lib/        contrato { ok, data } / { ok: false, error } y lógica
├── knowledge/reglas.json             reglas de negocio que aplican las herramientas
├── fixtures/reto-01/                 repositorio maestro, soportes y casos de ejemplo
├── ejemplo.ts                        flujo completo sin modelo ni servidor
└── package.json                      dependencias: zod, exceljs, pdf-lib
```

`agent.md` declara `mode: primary` y `permission { edit: deny, bash: deny }`: el agente no edita
archivos ni ejecuta comandos; solo actúa a través de sus herramientas.

## 3. Probarlo en un minuto

```bash
unzip agente-registro-proveedor.zip && cd agente-registro-proveedor
npm install
npm run ejemplo            # o: npm run ejemplo -- hn-agroexport-sula
```

Genera en `out/<caso>/` el formulario (Excel, PDF o valores para portal), el checklist y el borrador de correo.

## 4. Integrarlo en una plataforma de agentes

1. **Agente**: registrar `agent.md` como agente primario (el cuerpo es el system prompt).
2. **Skill**: cargar `skill/registro-proveedor/SKILL.md` como conocimiento del agente.
3. **Herramientas**: registrar cada export de `tools/proveedor.ts` con el nombre `proveedor_<export>`.
   Cada herramienta expone `description`, `args` (esquemas zod) y `execute(args, ctx)`. Si la
   plataforma pide JSON Schema: `z.toJSONSchema(z.object(herramienta.args))`.
4. **Contexto**: en cada llamada pasar `ctx = { directory, sessionId }`, donde `directory` es la
   carpeta que contiene `fixtures/reto-01/` (datos de entrada) y donde se escribirá `out/` (resultados).
5. **Datos reales**: reemplazar `fixtures/reto-01/repositorio/` por el repositorio maestro y los
   soportes de la empresa, con la misma estructura.

| Herramienta | Entrada | Salida (`data`) |
|---|---|---|
| `proveedor_leer_solicitud` | `{ caso }` | país, cliente, formato, campos, soportes, campos ambiguos |
| `proveedor_mapear_campos` | `{ caso, campos[] }` | `mapeo_id`, llenos (con ruta del dato), faltantes, requiere_confirmacion |
| `proveedor_generar_formulario` | `{ caso, mapeo }` | ruta del formulario y formato |
| `proveedor_armar_paquete` | `{ caso }` | ruta del paquete, `listo_para_firma`, checklist |
| `proveedor_solicitar_confirmacion` | `{ caso, accion, resumen }` | acción pendiente de aprobación humana |
| `proveedor_simular_envio` | `{ caso, confirmado }` | ruta de `ENVIO-SIMULADO.md`, o error "requiere confirmación explícita" |

Todas devuelven un string JSON y **nunca lanzan excepciones**.

### Confirmación humana

`proveedor_simular_envio` exige siempre `confirmado: true`. Si la plataforma tiene su propio sistema
de permisos, se recomienda marcar esta herramienta como "requiere aprobación". Si el host pasa
`ctx.confirmaciones` (conjunto `accion:caso` aprobado por una persona en el turno anterior), la
herramienta valida además esa aprobación, como lo hace el servidor de esta aplicación.

## 5. Una sola fuente de verdad

En el repositorio, estas piezas **no son copias**: `agent.md` y `SKILL.md` se generan desde
`backend/agent/prompt.md` y `backend/src/knowledge/registro-proveedor.md` (`npm run modulo`),
`modulo/tools/proveedor.ts` re-exporta las herramientas del backend, y el `.zip` se arma en el
momento de publicar desde esos mismos archivos. El CI falla si alguna pieza queda desactualizada
(`npm run modulo:check`).
