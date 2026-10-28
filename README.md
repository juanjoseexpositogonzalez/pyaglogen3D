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
