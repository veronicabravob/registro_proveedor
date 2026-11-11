# SOLUCIÓN — Reto 01 · Agente "Registro como Proveedor"

> Link: https://registro-proveedor-fl6d.onrender.com · Repositorio: este · PRD: [`docs/PRD.md`](docs/PRD.md)

## 1. Problema en una frase

**La analista administrativa de Periferia transcribe a mano, campo por campo, la misma información
de la empresa en 8–12 formularios de registro de proveedor al mes**, buscando soportes dispersos y
dependiendo de una sola persona que sabe qué pide cada país; eso retrasa la facturación y arriesga
errores en datos sensibles (NIT, cuenta bancaria). Le duele a la analista (retrabajo), al área
administrativa (dependencia de una persona) y a finanzas (días de retraso para poder facturar).

## 2. Arquitectura

```
┌──────────────────────┐  HTTP JSON  ┌───────────────────────────────────────────────────────┐
│ frontend/ (React)    │ ──────────▶ │ src/http/app.ts  Hono · CSP · rate limit · clave      │
│ · historial          │ ◀────────── │        │                                              │
│ · pasos en vivo (SSE)│             │ src/agent/servicio.ts  sesión (memoria, TTL, LRU)     │
│ · banner confirmación│             │        │                                              │
└──────────────────────┘             │ src/agent/ciclo.ts  ReAct · topes · puerta humana     │
                                     │        │                     │                        │
                                     │ src/llm/adapter.ts      src/tools/index.ts            │
                                     │  └ anthropic.ts (Claude)     └ proveedor.ts (zod)     │
                                     │        │                     │                        │
                                     │ src/telemetry/ ── OpenTelemetry ──▶ Langfuse / OTLP   │
                                     └────────┼─────────────────────┼────────────────────────┘
                                              │                     │
                              backend/agent/ + backend/src/knowledge/   fixtures/ (solo lectura)
                              (system prompt estable)            out/      (escritura)
```

| Capa               | Dónde vive                                                    | Qué contiene                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Comportamiento** | `backend/agent/prompt.md`                                     | Rol, orden de trabajo, regla "solo valores de herramientas", protocolo de confirmación, formato del resumen.                                                                                                  |
| **Conocimiento**   | `backend/src/knowledge/registro-proveedor.md` + `reglas.json` | Proceso de negocio legible (se inyecta en el contexto) y parámetros que las herramientas aplican de forma determinista: identificador por país, umbrales de confianza, campos sensibles, nombres de soportes. |
| **Ejecución**      | `backend/src/tools/proveedor.ts` (+ `lib/`)                   | 6 herramientas tipadas con zod, sin dependencia del servidor, importables desde `demo.ts` y desde `modulo/`.                                                                                                  |

Un cambio de reglas de negocio (p. ej. agregar Guatemala → NIT) se hace en `reglas.json` y en el
`.md` de conocimiento; no toca el servidor ni el ciclo.

**Herramientas** (nombre visible para el modelo `proveedor_<export>`):

| Herramienta                        | Entrada                                  | Salida (`data`)                                                                       |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `proveedor_leer_solicitud`         | `{ caso }`                               | `{ pais, cliente, formato, campos[], soportes[], campos_ambiguos[], correo_cliente }` |
| `proveedor_mapear_campos`          | `{ caso, campos[] }`                     | `{ mapeo_id, llenos[], faltantes[], requiere_confirmacion[] }`                        |
| `proveedor_generar_formulario`     | `{ caso, mapeo }` (`mapeo` = `mapeo_id`) | `{ ruta, formato, soportado, aviso? }`                                                |
| `proveedor_armar_paquete`          | `{ caso }`                               | `{ ruta, listo_para_firma, bloqueos[], checklist }`                                   |
| `proveedor_solicitar_confirmacion` | `{ caso, accion, resumen }`              | `{ pendiente, accion, caso }`                                                         |
| `proveedor_simular_envio`          | `{ caso, confirmado }`                   | `{ ruta }` o `{ ok: false, error: "requiere confirmación explícita" }`                |

Todas devuelven un string JSON `{ ok, data }` / `{ ok: false, error }`, **nunca lanzan**
(`backend/src/tools/lib/definir.ts` envuelve validación, captura de errores y bitácora RN5), y resuelven rutas desde
`ctx.directory` con nombres de caso validados (sin _path traversal_).

## 3. Ciclo del agente

Implementado a mano en `backend/src/agent/ciclo.ts` siguiendo el patrón **ReAct** (Yao et al., 2023):
el modelo razona y decide una acción (herramienta), observa el resultado y repite hasta responder.

```
turno(usuario):
  resolver confirmación pendiente (solo vale para ESTE mensaje)       ← RN4
  mientras iteraciones < MAX_ITERATIONS_PER_TURN (25):                ← CA1
    si tokens de la sesión ≥ MAX_TOKENS_PER_SESSION → cortar          ← costo
    respuesta = llm.enviar(system, historial, herramientas)
    si rechazo → responder sin tocar el historial
    si no hay llamadas → respuesta final
    para cada llamada (en orden):
      validar args con zod → error al modelo si no cumple            ← §6.2
      si la herramienta es externa y no hay aprobación humana → bloquear
      ejecutar · bitácora out/log.jsonl · span OTel · métricas        ← CA4
    agregar llamadas + resultados juntos (historial siempre consistente)
  tope alcanzado → resumen determinista de lo hecho y lo que falta    ← CA1
```

- **Tope de iteraciones (CA1)**: al llegar a 25 no se hace otra llamada al modelo; el servidor
  responde con la lista de herramientas ejecutadas y cómo continuar. También hay tope de tokens por
  sesión, límite de solicitudes por IP/minuto y largo máximo de mensaje.
- **Valores solo de herramientas (CA2)**: el prompt lo prohíbe y **el diseño lo hace innecesario**:
  `generar_formulario` recibe un `mapeo_id`, no valores. El mapeo se persiste en `out/<caso>/mapeo.json`
  y el formulario se escribe desde ahí, de modo que **ningún dato pasa por el modelo** antes de llegar
  al archivo. Un `mapeo_id` inventado es rechazado.
- **Confirmación humana (CA3, RN4)**: es una puerta en el **host**, no una promesa del modelo.
  1. Para enviar, el modelo debe llamar `proveedor_solicitar_confirmacion`; el servidor guarda la
     acción pendiente y responde `needsConfirmation: true` (el front muestra un banner amarillo con
     botones Sí/No).
  2. Solo el **mensaje siguiente** puede aprobarla: botón (`confirm: true`) o texto afirmativo corto
     y sin negaciones ("sí", "confirmo"; "sí pero espera" no cuenta). La pendiente se consume siempre.
  3. Si se aprobó, el host agrega `simular_envio:<caso>` a `ctx.confirmaciones`. Si el modelo
     intenta enviar sin esa aprobación —aunque pase `confirmado: true`— el ciclo y la herramienta lo
     rechazan con `requiere confirmación explícita` (probado en `test/ciclo.test.ts`).
- **Errores claros (CA5)**: los errores del SDK se mapean por tipo (timeout, 429, 401, 400, red)
  a mensajes en español; la sesión sigue viva. Timeout configurable (`LLM_TIMEOUT_MS`) y 2 reintentos.
- **Prompt caching**: system prompt y herramientas forman un prefijo estable (sin fechas ni ids), con
  `cache_control`; en la prueba real, ~57 % de la entrada de un caso se leyó de caché.

## 4. Elección del modelo

|             |                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proveedor   | Anthropic (SDK oficial `@anthropic-ai/sdk`)                                                                                                                                                                                                                      |
| Modelo      | `claude-opus-5-5`, esfuerzo `medium` (configurable con `LLM_MODEL` / `LLM_EFFORT`)                                                                                                                                                                               |
| Por qué     | Uso de herramientas multi-paso fiable (encadena las 4 herramientas sin guía adicional), muy buen español, sigue instrucciones de "no inventar" y de confirmación; 1M de contexto; fallback de servidor ante rechazos de clasificadores (`fallbacks: "default"`). |
| Alternativa | `claude-sonnet-5-5` (mitad de precio) solo cambiando `LLM_MODEL`. El adaptador no cambia.                                                                                                                                                                        |

**Costo medido** (tarifas $4 / $20 por MTok de entrada / salida, lectura de caché $0,20, escritura $5):
el turno "procesa ec-corp-andina" usó 35,4 k tokens de entrada (20,2 k desde caché, 5,0 k escritos
a caché, 10,2 k sin caché) y 1,2 k de salida:

| Concepto                     | Tokens | Costo       |
| ---------------------------- | ------ | ----------- |
| Entrada sin caché            | 10.200 | $0,041      |
| Escritura de caché           | 5.040  | $0,025      |
| Lectura de caché             | 20.170 | $0,004      |
| Salida                       | 1.170  | $0,023      |
| **Total por caso procesado** |        | **≈ $0,09** |

Un caso completo con envío confirmado (3 turnos) ronda **$0,15–0,20**; con 12 casos al mes, menos de
**$3/mes**. El tope `MAX_TOKENS_PER_SESSION=400000` limita el peor caso por sesión a ~$2.

## 5. Diseño del portal web (formato "portal con usuario y contraseña")

Hoy el agente responde **"formato no soportado"** y genera `valores-portal.md` (tabla etiqueta /
valor / estado / fuente) listo para copiar. Diseño para una fase siguiente:

**Estrategia**: navegador controlado (Playwright) en un **worker aislado**, con un "mapa de portal"
por cliente (selectores y pasos versionados como datos, igual que las plantillas), y el agente
actuando como copiloto: rellena campos, pero no autentica ni envía.

| Alternativa                       | Ventaja                                                                 | Descartada / límite                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Navegador controlado (Playwright) | Reproducible, testeable, sin licencias                                  | **Elegida**; frágil ante cambios de layout → mapas versionados + detección de cambios (captura y diff) que degrada a `valores-portal.md`. |
| RPA comercial                     | UI para no técnicos                                                     | Costo y licencias para 8–12 casos/mes.                                                                                                    |
| Extensión de navegador            | Corre en la sesión del humano: credenciales, MFA y CAPTCHA ya resueltos | Buena opción de "autollenado asistido" como plan B; requiere instalar y mantener la extensión.                                            |

**Límites**: CAPTCHA y MFA **no se evaden**; se detectan y el control pasa al humano. Cambios de
layout → el mapa falla de forma explícita y se vuelve al modo copiable.

**Credenciales**: nunca en el repositorio, el prompt, el contexto del modelo ni los logs. Viven en un
gestor de secretos (Azure Key Vault / 1Password / Bitwarden) bajo una identidad de servicio; el
worker las inyecta directamente en el campo del navegador, sin pasar por el modelo. Mejor aún: el
humano inicia sesión en una ventana del navegador controlado y el worker continúa en esa sesión.

**Reparto agente / humano**:

| Paso                                                            | Quién                                  |
| --------------------------------------------------------------- | -------------------------------------- |
| Abrir portal y **ingresar credenciales / MFA / CAPTCHA**        | **Humano**                             |
| Navegar al formulario y llenar campos con los valores del mapeo | Agente (worker)                        |
| Adjuntar soportes vigentes                                      | Agente, con lista de archivos aprobada |
| Revisar captura del formulario lleno                            | Humano                                 |
| **Clic en "Enviar"**                                            | **Humano** (siempre)                   |
| Registrar el envío y el acuse                                   | Agente                                 |

## 6. Decisiones y trade-offs

| #   | Decisión                                                                                               | Alternativa descartada                                 | Por qué                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Mapeo determinista** (glosario → clave literal → similitud de Dice con umbrales 0,8 / 0,6) en código | Pedir al LLM que mapee etiquetas                       | Reproducible, auditable (ruta `maestro.json#clave`), probado y gratis; el LLM podría "completar" valores. La similitud cubre variantes; lo dudoso queda en `requiere_confirmacion`.                                                                                                            |
| 2   | **Formulario desde `mapeo_id`** persistido                                                             | Pasar el mapeo (con valores) como argumento del modelo | Garantiza CA2 por diseño: el modelo no puede alterar un NIT o una cuenta en tránsito. Coste: una lectura de archivo.                                                                                                                                                                           |
| 3   | **Ciclo propio** con adaptador `enviar()`                                                              | Tool Runner del SDK / frameworks (LangChain, AutoGen)  | El PRD exige que cambiar de proveedor no toque el ciclo, y la puerta de confirmación debe vivir en el host. Un agente único basta: multiagente (Wu et al., 2023) añadiría costo y latencia sin beneficio aquí.                                                                                 |
| 4   | **Confirmación como herramienta + estado en el host**                                                  | Detectar "¿confirmas?" en el texto del modelo          | Señal estructurada y verificable; el front sabe exactamente qué acción y caso aprobar.                                                                                                                                                                                                         |
| 5   | **PDF generado** con pdf-lib                                                                           | Rellenar un AcroForm                                   | El PRD lo acepta; no hay PDF original en los fixtures. pdf-lib es JS puro (sin binarios nativos).                                                                                                                                                                                              |
| 6   | **Sesiones en memoria** con TTL y LRU                                                                  | Base de datos / archivo                                | No-objetivo del PRD; en Render free el disco es efímero. Se pierde el historial al reiniciar (aceptado).                                                                                                                                                                                       |
| 7   | **OpenTelemetry neutral** + Langfuse como destino                                                      | SDK propietario de Langfuse en el código               | Las trazas usan semántica `gen_ai.*`; cambiar a Grafana/Honeycomb es configuración. El SDK de Anthropic aporta sus spans nativos.                                                                                                                                                              |
| 8   | **Biome**                                                                                              | ESLint + Prettier                                      | Una sola herramienta, rápida y liviana (disco limitado en la máquina de desarrollo).                                                                                                                                                                                                           |
| 9   | **Front en React + Vite + TypeScript**, monorepo `backend/` + `frontend/`                              | HTML plano / front servido aparte                      | El chat tiene estado real (conversaciones, pasos en vivo, confirmaciones); componentes y un hook concentran esa lógica, y la lógica de dominio del front se prueba sin navegador. Un solo despliegue: el backend sirve `frontend/dist` en el mismo origen (sin CORS).                          |
| 10  | **Lenguaje de negocio en la interfaz**; detalle técnico plegado                                        | Mostrar nombres de herramientas y JSON en primer plano | La usuaria es la analista administrativa. Cada paso se lee como "Leí la solicitud", "Armé el paquete…"; el nombre de la herramienta, lo que se le pidió y lo que respondió siguen visibles al desplegar (PRD §6.1). El prompt también pide hablar por nombre de cliente, sin rutas ni códigos. |
| 11  | **Streaming SSE** del avance del turno                                                                 | Solo respuesta al final / WebSockets                   | La analista ve cada paso en vivo ("Estoy armando el paquete…"); SSE sobre POST es unidireccional y basta, sin estado de conexión adicional. `/api/chat` (JSON) se mantiene para integraciones y pruebas.                                                                                       |

**Dependencias** (todas justificadas): `@anthropic-ai/sdk` (modelo), `zod` (contrato de
herramientas, configuración y API), `hono` + `@hono/node-server` (HTTP y SSE, testeable sin
puertos), `react` + `react-dom` + `react-markdown` (interfaz; markdown sin HTML crudo), `vite` (build del front), `exceljs` (escribir celdas exactas, conservando texto), `pdf-lib` (PDF sin binarios),
`@opentelemetry/*` + `@langfuse/otel` (trazas y métricas), `tsx` (ejecutar TypeScript en Node).
Desarrollo: `typescript`, `@types/node`, `@biomejs/biome`. Pruebas con `node:test` (sin dependencia).

## 7. Supuestos

1. "Fecha de ejecución" = fecha del servidor (configurable con `FECHA_EJECUCION` para reproducir).
   Con fecha real (2026-11-10) la Cámara de Comercio está vencida en todos los casos, por lo que
   ningún paquete queda listo para firma; con `FECHA_EJECUCION=2026-09-15` `co-industrias-delta` sí.
2. El caso portal (`pa-logistica-istmo`) trae `plantilla-campos.json`; se usa como la lista de campos del portal.
3. El RUC de Ecuador/Panamá y el RTN de Honduras se llenan con el NIT y quedan en `requiere_confirmacion` (RN1),
   aunque la etiqueta coincida con el identificador del país.
4. Un campo que el glosario mapea a una clave sin valor en el maestro es `faltante` (no se inventa).
5. "Copias de los soportes exigidos que existan" incluye soportes vencidos (se copian y se marcan vencidos).
6. Se permite simular el envío de un paquete **no listo** si el humano lo confirma explícitamente
   tras ver las advertencias; `ENVIO-SIMULADO.md` deja constancia de ese estado.
7. La Excel se genera nueva (no hay `.xlsx` original en los fixtures) respetando hoja y celdas exactas.
8. El link puede protegerse con clave; la clave se entrega por separado al equipo evaluador.

## 8. Cobertura

| Historia                             | Estado                                                       | Evidencia                                                                                                            | Falta para producción                                                  |
| ------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| HU-1 Leer la solicitud               | **Hecho**                                                    | `leer_solicitud`, ambiguas con equivalente por país                                                                  | Leer el `.xlsx`/`.pdf` real del adjunto en vez de un JSON normalizado. |
| HU-2 Mapear campos                   | **Hecho**                                                    | 3 estados, ruta del dato, glosario, umbral 0,8, RN1                                                                  | Revisión humana de sinónimos nuevos que alimente el glosario.          |
| HU-3 Formulario                      | **Hecho** P0 xlsx · P1 pdf · P2 portal (`valores-portal.md`) | Pruebas leen la celda exacta del Excel generado                                                                      | Rellenar la plantilla original del cliente y AcroForms.                |
| HU-4 Paquete para firma              | **Hecho**                                                    | checklist con presentes/ausentes/vencidos, borrador sin datos bancarios, confirmación antes de enviar                | Firma electrónica y envío real (fuera de alcance).                     |
| HU-5 Errores                         | **Hecho**                                                    | Caso inexistente, plantilla corrupta, args inválidos, timeout del modelo                                             | Alertas operativas sobre la tasa de errores.                           |
| Agente para otras plataformas (§9.4) | **Hecho**                                                    | Paquete descargable (release) con prompt, skill y herramientas, generado de las mismas fuentes; `modulo:check` en CI | Versionado semántico y publicación en un registro de paquetes.         |
| Front según diseño                   | **Hecho**                                                    | React con el prototipo de `docs/diseno/`: pasos en vivo, progreso de 5 puntos, confirmación resaltada, descargas     | Pruebas de componentes y de accesibilidad automatizadas.               |
| Link público                         | **Hecho**                                                    | Render, autodeploy desde `main`                                                                                      | Plan pagado (sin "cold start"), dominio propio.                        |

**Calidad**: 61 pruebas (`node:test`: 54 del backend y 7 del dominio del front): herramientas, ciclo con LLM guionado, API, telemetría y
módulo. Cobertura ≈ 97 % líneas / 86 % ramas, con umbrales que hacen fallar el CI.
CI en cada rama: Biome, tipos estrictos, pruebas, `demo.ts` sin claves, `npm audit`, gitleaks;
CodeQL; dependency review; Dependabot. GitHub _push protection_ bloqueó una vez un secreto: funcionó.

**Observabilidad**: trazas y métricas del agente en Langfuse; detalle en la sección 11.

## 9. Uso de IA

Se usó **Claude Code (modelo Claude Opus 5.5)** como asistente de ingeniería en tres frentes. La
dirección del trabajo, la validación de cada entrega y las decisiones finales fueron mías.

| Frente                              | En qué ayudó la IA                                                                                                                                                                                                                     | Qué decidí y validé                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Levantamiento del requerimiento** | Desglosar el PRD en historias, reglas (RN1–RN5) y reglas del ciclo (CA1–CA5); cruzarlas con los fixtures para detectar casos borde (identificador extranjero, soportes vencidos con la fecha real, formato portal, campos sin fuente). | Alcance y prioridades (P0 Excel, P1 PDF, P2 portal como valores copiables), supuestos de la sección 7 y criterios de "hecho" para cada historia.       |
| **Propuesta de arquitectura**       | Proponer y contrastar alternativas: ciclo propio vs. frameworks, mapeo determinista vs. por LLM, confirmación en el host vs. en el prompt, monorepo backend/frontend, OpenTelemetry neutral con Langfuse como destino.                 | Elegir la arquitectura final y sus trade-offs (sección 6), con base en la bibliografía de agentes (ReAct, RAG, NIST AI RMF).                           |
| **Construcción del código**         | Implementación de herramientas, ciclo del agente, adaptador del modelo, telemetría, API, front en React según el prototipo de diseño entregado, pruebas, CI/CD y despliegue en Render.                                                 | Revisión de cada cambio en su rama, con CI en verde antes de integrar a `main`, y prueba de punta a punta con el modelo real antes de cada despliegue. |

**Decisiones tomadas sobre lo que propuso la IA** (qué se descartó y por qué):

| Propuesta inicial                                           | Decisión                                                      | Motivo                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Usar el _Tool Runner_ del SDK para el ciclo                 | Ciclo propio con adaptador `enviar()`                         | El PRD exige cambiar de proveedor sin tocar el ciclo, y la confirmación humana debe vivir en el host, no en el modelo. |
| Que el modelo mapee las etiquetas del cliente               | Mapeo determinista en código + estado `requiere_confirmacion` | Reproducible, auditable y sin riesgo de valores "plausibles" inventados.                                               |
| Pasar el mapeo (con valores) al generador del formulario    | El generador recibe solo un `mapeo_id`                        | Ningún NIT ni cuenta pasa por el modelo: CA2 garantizado por diseño.                                                   |
| Detectar el "sí" con una expresión amplia                   | Lista corta de afirmaciones sin negación + botones explícitos | La versión amplia aprobaba frases como "sí, pero espera".                                                              |
| Auto-instrumentación completa de OpenTelemetry              | Spans semánticos propios + spans nativos del SDK              | Menos ruido y peso; trazas legibles en Langfuse.                                                                       |
| Interfaz con nombres de herramientas y JSON en primer plano | Lenguaje de negocio; detalle técnico plegado                  | La usuaria es la analista administrativa; el PRD exige mostrar las llamadas, no que sean lo principal.                 |
| Publicar la clave de acceso del link en el README           | Se entrega por separado                                       | Un repositorio público expondría la clave y el costo del modelo.                                                       |

## 10. Riesgos de llevarlo a producción y mitigaciones

Organizados con las funciones del **NIST AI RMF 1.0** (Gobernar, Mapear, Medir, Gestionar).

| Riesgo                                              | Mitigación actual                                                                                                                   | Siguiente paso                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| El modelo "completa" un dato faltante               | Valores solo desde herramientas; formulario desde `mapeo_id`; prompt lo prohíbe                                                     | Evaluación automática: comparar cada valor del formulario contra el maestro antes de la firma.      |
| Inyección de instrucciones en el correo del cliente | `correo_cliente` marcado como no confiable; acciones externas tras puerta humana en el host                                         | Clasificador de inyección y aislamiento del cuerpo del correo.                                      |
| Envío sin autorización                              | Puerta de confirmación en el host, consumida en el siguiente mensaje; probado                                                       | Aprobación con identidad (quién aprobó) y doble control para paquetes no listos.                    |
| Fuga de datos sensibles                             | Datos bancarios fuera del correo (RN2); enmascarado en trazas; clave del modelo solo en el entorno; CSP; gitleaks y push protection | Cifrado de `out/`, retención limitada y acceso por roles.                                           |
| Costo descontrolado / abuso del link                | Clave de acceso, rate limit por IP, topes de iteraciones y tokens por sesión                                                        | Presupuesto mensual con alertas desde las métricas de tokens.                                       |
| Maestro desactualizado                              | Ruta del dato trazable; vigencias evaluadas en cada armado                                                                          | Dueño del dato y alertas de vencimiento antes de que ocurran (p. ej. Cámara de Comercio a 30 días). |
| Plantillas reales peores que los fixtures           | Validación zod con errores claros; el proceso continúa                                                                              | Lectura del adjunto real, golden set de plantillas por cliente y evaluación continua.               |
| Pérdida de sesión al reiniciar                      | Aceptado (no-objetivo)                                                                                                              | Persistencia en Redis/Postgres si se usa a diario.                                                  |
| Cambio o caída del proveedor del modelo             | Adaptador intercambiable, reintentos, fallback de servidor                                                                          | Segundo proveedor configurado como respaldo.                                                        |

## 11. Observabilidad con Langfuse

Cada conversación queda trazada en **Langfuse Cloud** mediante **OpenTelemetry**, sin acoplar el
código a Langfuse: si mañana se usa Grafana, Datadog o Honeycomb, solo cambia la configuración.

**Qué se ve en Langfuse por cada turno** (agrupado por sesión de chat):

```
invoke_agent registro-proveedor              AGENT       mensaje de la analista → respuesta
├── anthropic.messages.create                GENERATION  modelo, tokens, caché, latencia
├── execute_tool proveedor_leer_solicitud    TOOL        argumentos → resumen del resultado
├── anthropic.messages.create                GENERATION
├── execute_tool proveedor_mapear_campos     TOOL
└── …
```

| Aspecto       | Implementación                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trazas        | Span por turno (`invoke_agent`) y por herramienta (`execute_tool`) con atributos `gen_ai.*` (convenciones semánticas de OpenTelemetry) y `langfuse.*` (sesión, tipo de observación, entrada y salida). El SDK de Anthropic aporta sus spans `anthropic.messages.create` anidados bajo el turno.                                                       |
| Métricas      | `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, tokens en caché, turnos por resultado, iteraciones, llamadas y duración por herramienta, confirmaciones (solicitada / aprobada / rechazada / bloqueada), errores por origen, campos por estado, paquetes listos para firma y sesiones activas. Se exportan a cualquier backend OTLP. |
| Privacidad    | Antes de exportar, los valores sensibles reales del maestro (cuenta bancaria, SWIFT, cédula) se reemplazan por `***`. Por defecto solo se exportan metadatos; el modo `content` (activo en el despliegue) agrega mensajes y respuestas ya enmascarados.                                                                                               |
| Configuración | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (región US) y `TELEMETRY_CONTENT_MODE`; opcionalmente `OTEL_EXPORTER_OTLP_ENDPOINT` para métricas y trazas a otro backend. Sin claves, la telemetría queda apagada y la app funciona igual.                                                                                         |
| Robustez      | Exportación por lotes y apagado ordenado: al recibir `SIGTERM` (reinicio de Render) se vacían los buffers para no perder las últimas trazas.                                                                                                                                                                                                          |

**Traces de demostración** (flujo del PRD §11 ejecutado en producción, una sola sesión):

| Turno                          | Qué muestra                                                              | Trace                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1. Procesar Corporación Andina | Las 4 herramientas encadenadas y 5 llamadas al modelo con tokens y caché | [ver trace](https://us.cloud.langfuse.com/project/cmwbfksbk04w7ad0efkeyfx6f/traces/962cb138c271638bce867135deb783a4) |
| 2. "envía"                     | El agente solicita la confirmación humana y no envía                     | [ver trace](https://us.cloud.langfuse.com/project/cmwbfksbk04w7ad0efkeyfx6f/traces/97d81b1ce09a5990dc06435633fc101e) |
| 3. "Sí, confirmo el envío."    | El host aprueba y se registra el envío simulado                          | [ver trace](https://us.cloud.langfuse.com/project/cmwbfksbk04w7ad0efkeyfx6f/traces/8944632fcf4e21def5bb016717e9ac5a) |

Los traces son públicos (solo lectura, datos ficticios y enmascarados): se abren sin cuenta de Langfuse.

Uso práctico: auditar qué herramientas usó el agente para llegar a cada respuesta, detectar turnos
lentos o costosos, medir el costo por caso con los tokens reales y revisar en qué paso falló una
conversación.

## 12. Integración con otras plataformas de agentes

El agente se entrega también como un **paquete descargable e independiente del servidor** de esta
aplicación, para integrarlo en otras plataformas de agentes:

- **Descarga**: [`agente-registro-proveedor.zip`](https://github.com/veronicabravob/registro_proveedor/releases/latest/download/agente-registro-proveedor.zip)
  (última release del repositorio), o `npm run modulo:empaquetar` desde el código.
- **Contenido**: `agent.md` (frontmatter `description`, `mode: primary`,
  `permission { edit: deny, bash: deny }` + system prompt), `skill/registro-proveedor/SKILL.md`
  (frontmatter `name`, `description` + conocimiento del proceso), `tools/proveedor.ts` (las mismas
  herramientas zod), reglas de negocio, datos de ejemplo y un `ejemplo.ts` que corre el flujo sin
  modelo ni servidor.
- **Uso**: `npm install && npm run ejemplo`; la guía de integración paso a paso está en
  [`modulo/README.md`](modulo/README.md).
- **Mismas piezas que la app**: `agent.md` y `SKILL.md` se generan desde el prompt y el conocimiento
  del backend, `modulo/tools/proveedor.ts` re-exporta las herramientas del backend y el `.zip` se arma
  al publicar desde esos mismos archivos. El CI falla si alguna pieza diverge, y el workflow de
  publicación prueba el paquete instalado de forma aislada antes de adjuntarlo a la release.

## 13. Quality gates en GitHub

El repositorio trabaja con **una rama por funcionalidad** (`feature/*`, `fix/*`, `ci/*`, `docs/*`,
`refactor/*`), commits convencionales y merge `--no-ff` a `main` **solo con todos los controles en
verde**. Cada push de cualquier rama ejecuta el pipeline; así un error se detecta antes de integrarse.

**Pipeline `CI` (`.github/workflows/ci.yml`)**: siete controles independientes:

| Control                         | Qué verifica                                                                                                     | Falla si…                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Lint y formato (Biome)          | Estilo uniforme, buenas prácticas, imports ordenados                                                             | hay código sin formato o un error de lint                                         |
| Tipos (tsc estricto, sin `any`) | Tipado estricto de backend y frontend; además, que el agente para otras plataformas esté sincronizado con la app | hay un error de tipos o `modulo/` quedó desactualizado                            |
| Pruebas y cobertura             | 54 pruebas del backend (herramientas, ciclo con LLM simulado, API, streaming, telemetría, paquete) y 7 del front | falla una prueba o la cobertura baja de 85 % líneas / 75 % ramas / 85 % funciones |
| Build del front (React + Vite)  | Que la interfaz compile para producción                                                                          | el build falla                                                                    |
| `demo.ts` sin modelo            | El requisito del PRD §6.6: los 4 casos corren sin ninguna clave y generan sus archivos                           | falta algún formulario o checklist                                                |
| Auditoría de dependencias       | `npm audit` de dependencias de producción                                                                        | hay vulnerabilidades de severidad alta                                            |
| Escaneo de secretos (gitleaks)  | Todo el historial de git                                                                                         | aparece una clave, token o credencial                                             |

**Seguridad adicional**

| Control                   | Qué hace                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CodeQL                    | Análisis estático de seguridad y calidad (`security-and-quality`) en cada PR, en `main` y semanalmente.                                                                                                                                               |
| Revisión de dependencias  | En cada PR bloquea dependencias nuevas con vulnerabilidades altas o licencias copyleft (GPL/AGPL).                                                                                                                                                    |
| Dependabot                | Propone cada semana actualizaciones de npm y de las actions, agrupadas (OpenTelemetry, dependencias de desarrollo).                                                                                                                                   |
| Push protection de GitHub | Rechaza un push que contenga secretos. Se activó una vez durante el desarrollo: un archivo con la clave del modelo quedó en un commit local, el push fue rechazado, se corrigió el commit y se reforzó `.gitignore`. La clave nunca salió del equipo. |

**Protección de `main`**: el ruleset versionado en `.github/rulesets/main.json` exige PR, los siete
controles en verde con la rama al día, conversaciones resueltas, alertas de CodeQL altas resueltas,
y prohíbe force-push y borrado de la rama.

**Publicación** (`.github/workflows/publicar-agente.yml`): al crear una etiqueta `v*` arma el paquete
del agente para otras plataformas, lo instala y prueba de forma aislada, y lo adjunta a la release.

**Despliegue continuo**: Render despliega `main` automáticamente (`render.yaml`) con verificación de
salud en `/api/health`. Si un build falla, la versión anterior sigue en servicio.

## Referencias

- Yao, S. et al. (2023). _ReAct: Synergizing reasoning and acting in language models._ ICLR. — patrón del ciclo.
- Lewis, P. et al. (2020). _Retrieval-augmented generation for knowledge-intensive NLP tasks._ NeurIPS. — respuestas ancladas en fuentes recuperadas: aquí, las herramientas sobre el maestro.
- Raieli, S. e Iuculano, G. (2025). _Building AI agents with LLMs, RAG, and knowledge graphs._ Packt. — prevención de alucinaciones con recuperación.
- Wooldridge, M. y Jennings, N. (1995). _Intelligent agents: Theory and practice._ — agente con percepción (herramientas de lectura) y acción acotada.
- Wu, Q. et al. (2023). _AutoGen._ — se evaluó multiagente y se descartó por complejidad sin beneficio.
- Albada, M. (2025). _Building Applications with AI Agents._ O'Reilly. — diseño de herramientas, intervención humana y observabilidad.
- Huyen, C. (2024). _AI Engineering._ O'Reilly. — evaluación, costos y guardrails.
- Rothman, D. (2025). _Context Engineering for Multi-Agent Systems._ Packt. — separación comportamiento / conocimiento / ejecución y prefijo estable.
- Ranjan, S. et al. (2025). _Agentic AI in Enterprise._ Apress. — gobierno y adopción empresarial.
- Tabassi, E. (2023). _AI RMF 1.0 (NIST AI 100-1)._ — marco de riesgos.
