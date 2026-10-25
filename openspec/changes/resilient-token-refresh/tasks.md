# Tasks — Resilient token refresh

GitHub: **#122**. Rama: `feature/resilient-token-refresh`.

**No se escribe código hasta que la issue #122 lleve la etiqueta `status:approved`.** Ese es el
gate vigente desde el 2026-10-22; `approval.md` ya no se usa.

## T0 — Instrumento y línea base

- [ ] T0.1 Declarar **Playwright como dependencia de desarrollo** en `frontend/package.json`.
      Hoy no está, y sin ella el diagnóstico no se ejecuta en un clon limpio.
- [ ] T0.2 Verificar que el diagnóstico **está versionado de verdad**: `git ls-files
      frontend/diagnostics` debe devolverlo. La ruta `frontend/scripts/` está en
      `.gitignore:75`, y un intento anterior de versionarlo ahí fue ignorado en silencio
      mientras el mensaje de commit afirmaba lo contrario.
- [ ] T0.3 Documentar en el propio fichero cómo se ejecuta (build de producción, backend, un
      proyecto con varias simulaciones) y comprobar que **otra persona puede correrlo** sin
      ficheros de `/tmp` ni credenciales incrustadas.
- [ ] T0.4 Registrar la línea base con **8 corridas por escenario** y guardar su salida JSON.
- [ ] T0.5 Registrar suite y `type-check` de partida, para no confundir una regresión propia
      con la intermitencia ajena ya conocida de `FraktalBatchImageDetail` y `FraktalBatchUpload`.

## T1 — Un refresco en vuelo por pestaña (R2)

- [ ] T1.1 Test primero: varias llamadas concurrentes producen **una** petición de refresco y
      todas resuelven con el mismo token.
- [ ] T1.2 Test primero: tras un refresco fallido, una llamada posterior **inicia uno nuevo**
      en vez de heredar la promesa ya resuelta.
- [ ] T1.3 Implementar la promesa compartida en `auth-api.ts`, liberándola al terminar con
      éxito **o** con fallo.
- [ ] T1.4 Falsificar ambos tests rompiendo la coalescencia y la liberación a propósito.

## T2 — Espera acotada (R3)

- [ ] T2.1 Test primero: un refresco que no responde dentro del plazo rechaza a quienes esperan
      con un error reintentable y **no toca las credenciales**.
- [ ] T2.2 Implementar el límite con `AbortController` en `auth-api.ts:117`.
- [ ] T2.3 Comprobar que tras el vencimiento **se puede volver a intentar**: el plazo no debe
      dejar la pestaña sin refresco posible.

## T3 — Un fallo deja de ser terminal (R4)

- [ ] T3.1 Test primero: fallo con token ya rotado → relee almacenamiento, reintenta **una vez**
      y **no** borra credenciales.
- [ ] T3.2 Test primero: fallo llevando el token vigente → tras el reintento, cierra sesión.
- [ ] T3.3 Test primero: error de red o 5xx al arrancar → **no** cierra sesión.
- [ ] T3.4 Sustituir el `clearTokens()` incondicional de `auth-api.ts:124` por esa distinción.
- [ ] T3.5 Aplicar la misma distinción en **los dos** manejadores de 401 de `api.ts`
      (`:82`/`:89` y `:128`/`:133`). Arreglar uno solo deja el defecto vivo por el otro.
- [ ] T3.6 Aplicarla también en `AuthContext.tsx` (`:58`, `:64`), que hoy borra credenciales
      ante cualquier error del refresco o de la petición de identidad.
- [ ] T3.7 Comprobar que el reintento está **acotado a uno**.

## T4 — Cierre de sesión y visitante anónimo (R5, R6)

- [ ] T4.1 Test primero: un refresco que responde **después** de cerrar sesión no escribe
      token ni cookie, y el usuario sigue fuera.
- [ ] T4.2 Implementarlo invalidando lo en vuelo al cerrar sesión.
- [ ] T4.3 Test primero: sin token guardado, una página pública **no** emite refrescos, no hace
      esperar a nadie y no redirige.

## T5 — Verificación

- [ ] T5.1 Suite completa en verde; ningún test preexistente pasa a rojo.
- [ ] T5.2 `npx tsc --noEmit` sin errores nuevos sobre la línea base de T0.5.
- [ ] T5.3 `npm run build` en exit 0.
- [ ] T5.4 Diagnóstico con **8 corridas por escenario**, contrastado contra el JSON de T0.4:
      expulsiones **0**, y **código de salida 0**. La evidencia es el código de salida, no una
      lectura de consola.
- [ ] T5.5 **Volver a medir el par de dos pestañas** (R7). Registrar la cifra. Si persisten
      expulsiones, abrir la coordinación entre pestañas como trabajo propio con esta evidencia;
      si no quedan, dejar escrito que el cerrojo no hizo falta.
- [ ] T5.6 Verificación manual de acceso, cierre de sesión y sesión realmente caducada: el
      cambio está en el camino crítico de todo usuario.
- [ ] T5.7 Registrar en el Log las cifras de antes y después, no la impresión.

## T6 — Entrega

- [ ] T6.1 PR a `develop` enlazando #122, etiqueta `type:bug`.
- [ ] T6.2 Revisión adversarial antes del merge.
- [ ] T6.3 Archive con sincronización canónica de `session-continuity`, **escribiendo el
      `Purpose`**: el tooling lo deja en `TBD` y ese hueco ya tiene issue abierta (#93).
- [ ] T6.4 `state.yaml` actualizado.

## Log

<!-- Una entrada por tarea completada, con la evidencia que la respalda. -->

### L0 — Fase 0, y dos instrumentos que mentían (2026-10-25)

Medición final: 8 corridas por escenario, sesión aislada, build de producción.

| escenario | solapamiento | expulsiones | causa |
| --- | --- | --- | --- |
| detalle de proyecto | 5 | 1 de 8 | colisión |
| estudios batch | 3 | 1 de 8 | colisión |
| dos pestañas, pesada + ligera | 5 | 3 de 8 | colisión |
| dos pestañas, ligera + ligera | 1 | 0 de 8 | — |
| resto | 1-2 | 0 de 8 | — |

**Cascada: cero.** La hipótesis de que las muertes se propagaran por el borrado de credenciales
queda descartada con datos.

**El alcance se recortó por falta de evidencia.** La propuesta inicial incluía un cerrojo entre
pestañas. Dos pantallas ligeras no llegan a solapar refrescos y no fallan; el par pesada +
ligera falla más que la pesada sola, pero las colisiones internas de la pesada explican ese
aumento igual de bien y el instrumento no las separa. Se secuencia: arreglar lo demostrado,
volver a medir, y abrir el cerrojo solo si queda defecto.

**El instrumento mintió dos veces antes de servir.** Primero compartía sesión entre pantallas,
así que tras la primera expulsión medía el cadáver. Después ignoraba las rutas que decía
comparar, de modo que las dos «parejas» ejecutaban el mismo experimento y un 0 de 6 aparente
era ruido. Lo cazó **una cifra inexplicable** —solapamiento 5 donde cabían 2—, no una relectura
del código.

Regla que queda: **una cifra que no se sabe explicar no es evidencia**, aunque apunte en la
dirección esperada.

**Hallazgos del spec-review incorporados**: refresco sin límite de espera, cierre de sesión con
refresco en vuelo que resucita la sesión, `AuthContext` destruyendo credenciales ante cualquier
error, el segundo manejador de 401 en `api.ts` que nadie había citado, la carga anónima, y la
contradicción interna de la antigua R4.
