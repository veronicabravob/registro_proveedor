# Conocimiento del proceso: Registro como Proveedor

Este documento describe el proceso de negocio que el agente apoya. Es la fuente única de
conocimiento: se inyecta en el contexto del agente y se publica como skill en `modulo/`.
Los parámetros que las herramientas aplican de forma determinista viven en
`src/knowledge/reglas.json`; un cambio de reglas se hace aquí y allí, nunca en el servidor.

## Flujo del proceso

1. **Recepción** deja la solicitud del cliente (correo + plantilla) en la carpeta del caso.
2. **Leer la solicitud**: país, cliente, formato de salida (xlsx, pdf o portal), campos y soportes exigidos.
3. **Mapear campos** contra el repositorio maestro de Periferia. Cada campo queda en uno de tres estados:
   - `lleno`: el valor existe en el maestro; se registra la ruta del dato (`maestro.json#<clave>`).
   - `faltante`: no existe en el maestro. **Nunca se inventa un valor.**
   - `requiere_confirmacion`: mapeo con confianza < 0.8 o aplica una regla de país.
4. **Generar el formulario** en el mismo formato que envió el cliente.
5. **Armar el paquete para firma**: formulario, soportes, checklist y borrador de correo.
6. **Cierre humano**: la analista revisa; el representante legal firma; la analista decide el envío.

## Identificador tributario por país (RN1)

| País     | Código | Identificador |
| -------- | ------ | ------------- |
| Colombia | CO     | NIT           |
| Ecuador  | EC     | RUC           |
| Perú     | PE     | RUC           |
| Panamá   | PA     | RUC           |
| Honduras | HN     | RTN           |

Periferia solo tiene NIT colombiano. Para clientes de otros países el campo se llena con el NIT
y se marca `requiere_confirmacion` con la nota "identificador extranjero". Si la plantilla usa una
etiqueta genérica (p. ej. "Identificación tributaria") se propone el equivalente del país del cliente.

## Datos bancarios (RN2)

- Se llenan **solo** si la plantilla los pide explícitamente.
- **Nunca** se incluyen en `borrador-correo.md` ni en resúmenes de chat más allá de indicar que el campo quedó lleno.

## Soportes y bloqueo de firma (RN3)

| Situación                                                                       | ¿Bloquea `listo_para_firma`?     |
| ------------------------------------------------------------------------------- | -------------------------------- |
| Soporte exigido con `vigencia_hasta` anterior a la fecha de ejecución (vencido) | Sí                               |
| Soporte exigido que no existe en el repositorio (ausente)                       | Sí                               |
| Formulario no generado                                                          | Sí                               |
| Campo `faltante`                                                                | No, pero aparece en el checklist |
| Campo `requiere_confirmacion`                                                   | No, pero aparece en el checklist |

El certificado de Cámara de Comercio tiene vigencia de 30 días: si está vencido hay que solicitar uno nuevo.
Los soportes de Periferia son emitidos en Colombia; si el cliente es extranjero, se informa el país emisor.

## Acciones externas (RN4)

Enviar, firmar o cargar a un portal son decisiones humanas. El agente solo puede **simular** el
envío (`ENVIO-SIMULADO.md`) y solo después de una confirmación explícita del usuario en el turno
inmediatamente anterior. Si el paquete no está listo para firma, se advierte antes de pedir la confirmación.

## Portales web

El llenado de portales con usuario y contraseña no se automatiza: el agente responde
"formato no soportado" y entrega `valores-portal.md` con los valores listos para copiar.
El ingreso de credenciales y el clic en "Enviar" son siempre humanos.

## Trazabilidad (RN5)

Cada ejecución de herramienta deja un registro en `out/<caso>/log.jsonl` con `{ ts, herramienta, ok, resumen }`.
