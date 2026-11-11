# Conocimiento del proceso: Registro como Proveedor

> Reglas de negocio que el agente consulta. Un cambio de reglas se hace aquí, no en el servidor.

## Identificador tributario por país (RN1)

| País | Identificador |
|---|---|
| CO | NIT |
| EC | RUC |
| PE | RUC |
| PA | RUC |
| HN | RTN |

Periferia solo tiene NIT colombiano. Para otros países se llena con el NIT y se marca `requiere_confirmacion` ("identificador extranjero").

## Datos bancarios (RN2)

Solo si la plantilla los pide explícitamente. Nunca en `borrador-correo.md`.

## Bloqueo de firma (RN3)

- Soporte vencido → bloquea `listo_para_firma`.
- Soporte exigido ausente → bloquea.
- Campo `faltante` → no bloquea, pero aparece en el checklist.

## Acciones externas (RN4)

Requieren confirmación explícita del usuario en el turno inmediatamente anterior.
