# Design — Resilient token refresh

## Fase 0: lo que se midió antes de decidir

El contrato depende de una hipótesis sobre concurrencia, así que se midió primero. El
diagnóstico queda versionado en `frontend/scripts/diagnostics/refresh-storm.mjs`.

**Montaje**: build de producción, backend real, sesión aislada por pantalla (un contexto de
navegador y un inicio de sesión nuevos para cada una). Tres corridas.

**Refrescos concurrentes en una carga en frío**, idénticos en las tres corridas:

| pantalla | refrescos |
| --- | --- |
| detalle de proyecto | **5** |
| detalle de simulación | 3 |
| estudios batch | 3 |
| comparación | 2 |
| dashboard, proyectos, ajustes, admin | 1 |

**Expulsiones**: detalle de proyecto falló en **1 de 3** corridas (4 de sus 5 refrescos en 401).
El escenario de **dos pestañas** falló en **2 de 3**.

### Lo que la medición refutó

La hipótesis de partida era que bastaba con compartir una promesa en vuelo dentro de la
pestaña. **Es insuficiente.** Ese arreglo cubre el caso de 1 de cada 3, y deja vivo el de 2 de
cada 3. Un arreglo así se vería funcionar —la pantalla culpable deja de fallar— mientras el
defecto sigue presente para cualquiera con dos pestañas abiertas.

### Lo que la medición descubrió sin buscarlo

Un refresco fallido llama a `clearTokens()` (`auth-api.ts:125`). Eso borra el token de refresco,
de modo que **una sola colisión mata la sesión completa**, no la petición que colisionó. Es
independiente de la concurrencia y es un defecto por sí mismo: convierte un fallo recuperable
en pérdida de sesión.

Este hallazgo también contaminó la primera versión del diagnóstico, que compartía sesión entre
pantallas: tras la primera expulsión, las filas siguientes medían el cadáver en vez de la
pantalla. El instrumento se rehízo con sesión aislada, y solo entonces los números fueron
estables.

## Decisiones

### D1. El arreglo es del cliente; el backend no se toca

`ROTATE_REFRESH_TOKENS` con `BLACKLIST_AFTER_ROTATION` es una defensa correcta: limita la
ventana de uso de un token robado. El defecto no es que el servidor invalide el token anterior,
sino que **el cliente presente el mismo token cinco veces a la vez**.

Alternativa descartada: desactivar la rotación o la lista negra. Resolvería el síntoma
debilitando una propiedad de seguridad real para tapar un defecto de concurrencia nuestro.

### D2. Dos niveles de exclusión, no uno

| nivel | mecanismo | cubre |
| --- | --- | --- |
| dentro de la pestaña | una promesa compartida en vuelo | el caso de 1 de cada 3 |
| entre pestañas | cerrojo por origen (Web Locks), con respaldo | el caso de 2 de cada 3 |

El respaldo importa: `navigator.locks` no existe en todos los contextos. Donde falte, la
degradación debe ser **a reintento con espera**, nunca a cerrar la sesión. Un navegador sin
cerrojos debe comportarse como hoy en el peor caso, no peor.

### D3. Un 401 de refresco no es una prueba de que la sesión haya terminado

Hoy cualquier fallo borra las credenciales. La distinción que hay que hacer:

- **Recuperable**: el token presentado fue rotado por otro refresco concurrente. El token
  vigente está en el almacenamiento, y basta releerlo y reintentar.
- **Definitivo**: no hay token, está caducado, o el servidor lo rechaza tras un reintento con
  el token vigente. Solo entonces se cierra la sesión.

El reintento debe estar **acotado**: un intento tras releer el almacenamiento. Más que eso
convierte un fallo de credenciales en un bucle.

### D4. El diagnóstico se versiona con el cambio

«Esto está arreglado» tiene que ser comprobable por alguien que no estuvo aquí. El diagnóstico
mide expulsiones por escenario y se ejecuta igual antes y después, de modo que la afirmación
sea una cifra y no una impresión.

## Riesgos

- **La concurrencia no se demuestra con una corrida.** Los escenarios fallan 1 y 2 de cada 3,
  así que una verificación de una sola pasada puede salir verde con el defecto intacto. La
  verificación exige **repeticiones**, y su número se fija en las tareas.
- **Tocar autenticación puede romper el inicio de sesión.** El cambio es pequeño pero está en
  el camino crítico de todo usuario.
- **El caso multipestaña no se cubre con tests unitarios.** Requiere el diagnóstico de
  navegador; es una limitación a declarar, no a disimular.

## Fuera de alcance

- Cualquier cambio en `SIMPLE_JWT` o en el backend.
- Mover el token de acceso fuera de memoria: es una decisión de seguridad con su propio
  análisis, y esta ola no la prejuzga.
- La experiencia de sesión caducada de verdad (avisar antes de expulsar, recuperar el trabajo
  en curso), que merece su propio contrato.
