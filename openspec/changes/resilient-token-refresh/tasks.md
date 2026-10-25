# Tasks — Resilient token refresh

GitHub: **#122**. Rama: `feature/resilient-token-refresh`.

**No se escribe código hasta que exista `approval.md`.**

## T0 — Línea base

- [ ] T0.1 Dejar el diagnóstico ejecutable en `frontend/scripts/diagnostics/refresh-storm.mjs`
      y documentar cómo se corre (build de producción, backend real, datos sembrados). El
      diagnóstico **ya existe** de Fase 0; esta tarea lo deja utilizable por otra persona.
- [ ] T0.2 Registrar la línea base **con repeticiones**, no con una corrida: expulsiones por
      escenario sobre **10 corridas** de cada uno. Las cifras de Fase 0 (1 de 3 en una pestaña,
      2 de 3 en dos pestañas) provienen de tres corridas y son indicativas, no la línea base.
- [ ] T0.3 Registrar la suite y `type-check` de partida, para no confundir una regresión propia
      con la intermitencia ajena ya conocida de `FraktalBatchImageDetail` y `FraktalBatchUpload`.

## T1 — Un refresco en vuelo por pestaña (R2)

- [ ] T1.1 Test primero: varias llamadas concurrentes producen **una** petición de refresco y
      todas resuelven con el mismo token.
- [ ] T1.2 Implementar la promesa compartida en `auth-api.ts`, incluida su limpieza al terminar
      —con éxito o con fallo— para que un fallo no deje la promesa pegada y bloquee los
      refrescos siguientes.
- [ ] T1.3 Falsificar el test: romper la coalescencia a propósito y comprobar que falla.

## T2 — Coordinación entre pestañas (R3)

- [ ] T2.1 Test primero: con el cerrojo tomado, un segundo solicitante espera en vez de emitir
      su propia petición.
- [ ] T2.2 Implementar el cerrojo por origen (`navigator.locks`), tomándolo **alrededor de todo
      el refresco**, no solo de la petición de red: entre recibir el token y guardarlo hay una
      ventana en la que otra pestaña puede colarse.
- [ ] T2.3 Camino de respaldo donde no haya cerrojos: reintento acotado con espera. Test que
      cubra ese camino simulando su ausencia.
- [ ] T2.4 Verificar que el respaldo **no cierra sesión**: sin cerrojos el sistema puede ser más
      lento, nunca menos correcto que hoy.

## T3 — Un fallo deja de ser terminal (R4)

- [ ] T3.1 Test primero: un refresco que falla con un token ya rotado **no** borra credenciales,
      relee el almacenamiento y reintenta una vez.
- [ ] T3.2 Test primero: un refresco que falla llevando el token vigente **sí** cierra sesión
      tras el reintento.
- [ ] T3.3 Retirar el `clearTokens()` incondicional de `auth-api.ts:125` y sustituirlo por la
      distinción anterior.
- [ ] T3.4 Revisar el otro extremo: `api.ts:88` redirige a `/auth/login` cuando el refresco
      falla. Debe respetar la misma distinción, o reintroduce el defecto desde el otro lado.
- [ ] T3.5 Comprobar que el reintento está **acotado a uno**: un token realmente inválido debe
      cerrar sesión enseguida, no entrar en bucle.

## T4 — Verificación

- [ ] T4.1 Suite completa en verde; ningún test preexistente pasa a rojo.
- [ ] T4.2 `npx tsc --noEmit` sin errores nuevos sobre la línea base de T0.3.
- [ ] T4.3 `npm run build` en exit 0.
- [ ] T4.4 Diagnóstico **10 corridas por escenario**: expulsiones **0** en ambos. Una sola
      corrida verde no vale: los escenarios fallaban 1 y 2 de cada 3, así que una pasada puede
      salir limpia con el defecto intacto.
- [ ] T4.5 Comprobar a mano que el inicio de sesión, el cierre de sesión y la sesión realmente
      caducada siguen funcionando. El cambio está en el camino crítico de todo usuario.
- [ ] T4.6 Registrar en el Log las cifras de antes y después, no la impresión.

## T5 — Entrega

- [ ] T5.1 PR a `develop` enlazando #122, etiqueta `type:bug`.
- [ ] T5.2 Revisión adversarial antes del merge.
- [ ] T5.3 Archive con sincronización canónica de `session-continuity`, **escribiendo el
      `Purpose`**: el tooling lo deja en `TBD` y ese hueco ya tiene una issue abierta (#93).
- [ ] T5.4 `state.yaml` actualizado.

## Log

<!-- Una entrada por tarea completada, con la evidencia que la respalda. -->

### L0 — Fase 0, antes de lockear nada (2026-10-25)

Medido con sesión aislada por pantalla, build de producción, tres corridas.

Refrescos concurrentes en carga en frío, idénticos en las tres: detalle de proyecto **5**,
detalle de simulación 3, batch 3, comparación 2, el resto 1.

Expulsiones: detalle de proyecto **1 de 3**; dos pestañas **2 de 3**.

**La hipótesis de partida quedó refutada por insuficiente.** Se suponía que bastaba compartir
una promesa en vuelo dentro de la pestaña; eso cubre el caso de 1 de cada 3 y deja vivo el de
2 de cada 3. Un arreglo así se vería funcionar mientras el defecto sigue ahí.

**Hallazgo no buscado**: `auth-api.ts:125` borra las credenciales ante cualquier refresco
fallido, así que una sola colisión mata la sesión entera. Es un defecto independiente de la
concurrencia.

**El instrumento tuvo que rehacerse.** La primera versión compartía sesión entre pantallas:
tras la primera expulsión, las filas siguientes medían el cadáver. Con sesión aislada los
números pasaron a ser estables.
