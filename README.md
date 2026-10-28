# Evidencia visual — ola 2

Capturas del port del rediseño, pantalla a pantalla. Rama huérfana a propósito: son binarios de evidencia, no código, y no deben entrar en la historia de `develop`.

## Dashboard (issue #135, PR #167)

Ocho capturas: dos temas × cuatro anchos (320, 900, 1280, 1440).

**320 px es ancho soportado** desde el PR #134, por eso sustituye al 360 de la ola 1.

### Lo que el script mide, además de fotografiar

- desbordamiento horizontal
- contraste calculado de las micro-etiquetas
- si el primer *paint* ya lleva el tema correcto (escenario "sin destello")
- expulsiones a la pantalla de acceso

Resultado: **0 hallazgos automáticos, 0 expulsiones**, y el primer paint coincide con el tema en ambos casos.

### Lo que una captura no puede afirmar, y por eso se mira

Revisando a ojo: la tarjeta *"Scratch — quick checks"* no tiene descripción, así que su fila de métricas sube y **no alinea** con las otras dos tarjetas de la misma rejilla. No es un desbordamiento ni un fallo de contraste, así que ningún gate automático lo ve.

## Entorno

- backend Django en `:8001`, postgres en `:5433`, redis en `:6380`
- frontend construido con `NEXT_PUBLIC_API_URL=http://localhost:8001/api/v1`, servido en `:3001`
- puertos 3000 y 8000 ocupados por otro proyecto de la máquina
- usuario `demo@pyaglogen3d.dev`, 3 proyectos, 13 simulaciones

## Lista de proyectos (issue #172, PR #179)

Ocho capturas: dos temas × cuatro anchos (320, 900, 1280, 1440). **0 desbordes, 0 expulsiones.**

### Lo que estas capturas comprueban y los tests no

- **El hover del borde**, que estaba invertido: usaba `accent`, un token de superficie, así que el contorno se *aclaraba* al pasar el ratón hasta desaparecer. Ningún test lo veía, porque el mock de `next/link` descarta `className`. Ahora usa el token de marca, igual que el Dashboard.
- **La alineación de las tarjetas**: "Scratch — quick checks" no tiene descripción y aun así sus métricas quedan a la misma altura que las de sus vecinas. Era el hallazgo anotado al revisar las capturas del Dashboard.

### Un error de método, por si vuelve a pasar

La primera corrida produjo **2 capturas en vez de 8** y aun así informó de *"0 hallazgos"*. El script solo barre los cuatro anchos para una lista fija de pantallas, y esta no estaba en ella: a 320 px **no se miró nada**.

Un "0 hallazgos" solo significa algo si se sabe sobre qué se midió.
