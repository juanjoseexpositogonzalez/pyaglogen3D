# Evidencia visual — ola 1 del rediseño (`redesign-design-system`)

Rama **huérfana**: sin historia común con `develop` ni `main`, y **no se mergea nunca**.
Existe solo para que la issue de verificación pueda enlazar imágenes.

## Qué se capturó

- **Commit verificado**: `develop` tras los PR #116, #119, #117 y #118.
- **Build de producción** (`next build` + `next start`), no servidor de desarrollo.
- **60 capturas**: 18 superficies × 2 temas a 1440 px, más los cuatro breakpoints
  del contrato (1440, 1280, 900, 360) en las cuatro pantallas que el contrato
  declara críticas: dashboard, detalle de proyecto, comparación y detalle de
  simulación.
- Nombres: `<pantalla>--<tema>--<ancho>.png`.

## Qué NO es esto

- **Los datos son fabricados.** Tres proyectos y trece simulaciones sembrados
  para esta verificación, con métricas plausibles pero **inventadas**. Sirven
  para juzgar maquetación, densidad y estados —hay `completed`, `running`,
  `failed` y `queued` a propósito—, nunca para juzgar números.
- **Las pantallas de FRAKTAL salen vacías.** No se sembraron análisis de imagen:
  requieren subir imágenes reales y procesarlas. Se ve su estado vacío, no su
  contenido. Cobertura parcial, dicha en voz alta en vez de implícita.
- **Las capturas no juzgan.** Miden lo medible (desbordes, contraste, atributos
  del documento). Si algo "queda feo", eso lo dice una persona mirando.

## Medido, no mirado

| comprobación | resultado |
| --- | --- |
| Flash de tema (R2) | **pasa**: con preferencia oscura guardada, el primer pintado ya lleva `data-theme="dark"`, antes de hidratar |
| Contraste AA, tema claro | **mínimo 5.01:1**, mediana 14.64:1, 22 micro-etiquetas, 0 por debajo de 4.5:1 |
| Contraste AA, tema oscuro | **mínimo 7.04:1**, mediana 14.01:1, 22 micro-etiquetas, 0 por debajo de 4.5:1 |
| Desbordamiento horizontal a 360 px | **ninguno** en las pantallas de la ola con sesión válida (`scrollWidth` 360 exacto) |

## Dos defectos encontrados, ninguno de esta ola

1. **La sesión muere sola.** `ROTATE_REFRESH_TOKENS` con `BLACKLIST_AFTER_ROTATION`
   y cinco refrescos concurrentes: el primero rota el token y deja en la lista
   negra el que los demás llevan en vuelo. Reproducido: al refresco 36 llegan dos
   401 y el usuario acaba en login sin tocar nada.
2. **El header público heredado desborda a 360 px** (`scrollWidth` 363). Marcado
   anterior a esta ola, que solo le añadió la cesión al shell.

Ambos tienen issue propia.
