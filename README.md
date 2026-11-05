# Evidencia visual — detalle de proyecto (issue #174)

Ocho capturas del detalle de proyecto migrado al kit: dos temas × cuatro anchos (320, 900, 1280, 1440). Rama huérfana a propósito: son binarios de evidencia, no código.

## Cómo se produjeron, y qué NO prueban

El entorno local estaba apagado (postgres :5433, redis :6380, backend :8001) y los datos demo se perdieron con sus contenedores. Las capturas se tomaron contra `next dev` en :3001 con **las respuestas de la API interceptadas** por Playwright (`findings.json` guarda lo medido en cada corrida).

- Prueban: maquetación, jerarquía de encabezados, tokens de los dos temas, y qué hace el ancho disponible con la cabecera, los paneles y las lecturas.
- No prueban: integración con el backend, ni paginación real, ni sesión reales. Eso lo cubren los 944 tests y, en su día, el entorno completo.

## Lo que se midió además de fotografiar

- desbordamiento horizontal: **0 px** en las ocho
- errores de consola: **0**; peticiones fallidas: **0**
- tema aplicado en el primer paint: **sí** en las ocho
- hueco entre paneles: **16 px** (antes 0 px entre el primero y el segundo, 32 px entre el segundo y el tercero)

## Lo que solo se vio mirando

1. **A 320 px la cabecera medía 718 px**: el bloque de acciones de `PageHeader` llevaba `shrink-0`, y un ítem flex que no encoge nunca se estrecha lo suficiente para envolver a sus hijos, por mucho `flex-wrap` que declare. Desborde de 438 px. Arreglado en el primitivo, con test de guarda.
2. **A 320 px el texto de ayuda de un `Panel` quedaba en una columna de ~90 px** cuando el panel llevaba acción al lado: diez líneas de tres palabras junto a un botón. La cabecera del panel ahora se apila por debajo de `sm`.
3. **Dos paneles hermanos se tocaban sin hueco** (0 px), mientras el tercero llevaba 32 px: el ritmo de la página parecía un fallo de render.

Ninguno de los tres lo veía un gate automático de los que había: son medibles, pero había que medirlos.
