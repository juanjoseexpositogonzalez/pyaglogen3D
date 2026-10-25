# Tasks — Resilient token refresh

GitHub: **#122**. Rama: `feature/resilient-token-refresh`.

**No se escribe código hasta que la issue #122 lleve la etiqueta `status:approved`.** Ese es el
gate vigente desde el 2026-10-22; `approval.md` ya no se usa.

## T0 — Instrumento y línea base

- [x] T0.1 Playwright declarado en `frontend/package.json` **y `package-lock.json`
      regenerado**. Declararlo sin tocar el lock rompe `npm ci`, y `frontend/Dockerfile:19`
      construye la imagen de producción con ese comando: el gate real es `npm ci --dry-run` en
      verde, no la presencia de la línea en `package.json`.
- [x] T0.2 Verificar que el diagnóstico **está versionado de verdad**: `git ls-files
      frontend/diagnostics` debe devolverlo. La ruta `frontend/scripts/` está en
      `.gitignore:75`, y un intento anterior de versionarlo ahí fue ignorado en silencio
      mientras el mensaje de commit afirmaba lo contrario.
- [ ] T0.3 Documentar en el propio fichero cómo se ejecuta (build de producción, backend, un
      proyecto con varias simulaciones) y comprobar que **otra persona puede correrlo** sin
      ficheros de `/tmp` ni credenciales incrustadas.
- [x] T0.4 Registrar la línea base con **8 corridas por escenario** y **versionar su salida
      JSON** junto al diagnóstico, con la fecha y el commit medido. Sin artefacto versionado, el
      «antes» de T5.7 no es contrastable por quien revise el PR.
- [ ] T0.5 Registrar suite y `type-check` de partida, para no confundir una regresión propia
      con la intermitencia ajena ya conocida de `FraktalBatchImageDetail` y `FraktalBatchUpload`.

## T1 — Un refresco en vuelo por pestaña (R2)

- [x] T1.1 Test primero: varias llamadas concurrentes producen **una** petición de refresco y
      todas resuelven con el mismo token.
- [x] T1.2 Test primero: tras un refresco fallido, una llamada posterior **inicia uno nuevo**
      en vez de heredar la promesa ya resuelta.
- [x] T1.3 Implementar la promesa compartida en `auth-api.ts`, liberándola al terminar con
      éxito **o** con fallo.
- [x] T1.4 Falsificar ambos tests rompiendo la coalescencia y la liberación a propósito.

## T2 — Espera acotada (R3)

- [x] T2.1 Test primero: un refresco que no responde dentro del plazo rechaza a quienes esperan
      con un error reintentable y **no toca las credenciales**.
- [x] T2.2 Implementar el límite con `AbortController` en `auth-api.ts:117`.
- [x] T2.3 Comprobar que tras el vencimiento **se puede volver a intentar**: el plazo no debe
      dejar la pestaña sin refresco posible.

## T3 — Un fallo deja de ser terminal (R4)

- [x] T3.1 Test primero: fallo con token ya rotado → relee almacenamiento, reintenta **una vez**
      y **no** borra credenciales.
- [x] T3.2 Test primero: fallo llevando el token vigente → tras el reintento, cierra sesión.
- [x] T3.3 Test primero: error de red o 5xx al arrancar → **no** cierra sesión.
- [x] T3.4 Sustituir el `clearTokens()` incondicional de `auth-api.ts:124` por esa distinción.
- [x] T3.5 Aplicar la misma distinción en **los dos** manejadores de 401 de `api.ts`
      (`:82`/`:89` y `:128`/`:133`). Arreglar uno solo deja el defecto vivo por el otro.
- [x] T3.6 Aplicarla también en `AuthContext.tsx` (`:58`, `:64`), que hoy borra credenciales
      ante cualquier error del refresco o de la petición de identidad.
- [x] T3.7 Comprobar que el reintento está **acotado a uno**.

## T4 — Cierre de sesión y visitante anónimo (R5, R6)

- [x] T4.1 Test primero: un refresco que responde **después** de cerrar sesión no escribe
      token ni cookie, y el usuario sigue fuera.
- [x] T4.2 Implementarlo invalidando lo en vuelo al cerrar sesión.
- [x] T4.3 Test primero: sin token guardado, una página pública **no** emite refrescos, no hace
      esperar a nadie y no redirige.

## T5 — Verificación

- [ ] T5.1 Suite completa en verde; ningún test preexistente pasa a rojo.
- [ ] T5.2 `npx tsc --noEmit` sin errores nuevos sobre la línea base de T0.5.
- [ ] T5.3 `npm run build` en exit 0.
- [ ] T5.4 Diagnóstico con **8 corridas por escenario**, contrastado contra el JSON de T0.4:
      expulsiones **0**, y **código de salida 0**. La evidencia es el código de salida, no una
      lectura de consola.
- [ ] T5.5 **Volver a medir el par de dos pestañas** (R7). Registrar la cifra **y los solapes
      cruzados reales**. La coordinación entre pestañas se abre como trabajo propio **solo si
      queda alguna expulsión con causa `collision` en ese escenario**, no ante cualquier
      expulsión: una muerte posterior al arreglo puede venir del límite de espera de R3, que no
      tiene nada que ver con las pestañas. Y si los solapes cruzados siguen siendo 0, dejar
      escrito que **no se ha medido**, nunca que el cerrojo no haga falta.
- [ ] T5.6 Verificación manual de acceso, cierre de sesión y sesión realmente caducada: el
      cambio está en el camino crítico de todo usuario.
- [ ] T5.7 Registrar en el Log las cifras de antes y después, no la impresión.

## T6 — Entrega

- [ ] T6.1 PR a `develop` enlazando #122, etiqueta `type:bug` (existe desde el 2026-10-25).
- [ ] T6.2 Revisión adversarial antes del merge.
- [ ] T6.3 Archive con sincronización canónica de `session-continuity`, **escribiendo el
      `Purpose`**: el tooling lo deja en `TBD` y ese hueco ya tiene issue abierta (#93).
- [ ] T6.4 `state.yaml` actualizado.

## Log

<!-- Una entrada por tarea completada, con la evidencia que la respalda. -->

### L1 — T1 y T2, con las mutaciones que las probaron (2026-10-25)

**T1, coalescencia.** Una sola promesa en vuelo por contexto, liberada al terminar con éxito o
con fallo. Tres tests. Mutaciones: quitar la ranura → 1 fallo; no liberarla → 2 fallos.

**T2, espera acotada.** Cuatro tests. La decisión que importa: **la ranura guarda la petición,
no la espera**. Rendirse no cancela la rotación del servidor, así que la respuesta se guarda si
llega y las credenciales se dejan intactas si no.

Mutaciones: sin límite → 3 fallos; **límite dentro de la ranura → 1 fallo**. Esta segunda es la
que enseñó algo: pasa todos los demás tests y parece equivalente, pero al vencer libera el
hueco y deja salir un segundo refresco mientras el primero sigue en vuelo, reconstruyendo la
colisión. **El test que la caza se escribió porque la mutación encontró el hueco**, no porque
estuviera previsto.

**T3.4, clasificación del fallo** (el resto de T3 sigue pendiente). Cinco tests. Mutaciones:
borrar siempre → 1 fallo; sin reintento → 2 fallos; reintento ilimitado → 1 fallo.

La tercera no fallaba: **colgaba la suite**. Un guarda que solo detecta un defecto colgándose
es un *timeout* en CI, no un diagnóstico. El mock ahora deja de rotar el token tras unos
intentos, así que un reintento sin límite termina y falla por recuento de llamadas.

**Dos trampas del instrumental, ambas de estado de módulo.** La ranura es estado de módulo, así
que sin un módulo fresco por test uno se une al refresco que otro dejó colgado y mide la
petición ajena. Y al resetear módulos, `auth-api` recibe una copia **nueva** de `session-end`:
el listener del test escuchaba otra instancia, así que el código señalaba correctamente y el
test veía cero.

**Verificación**: 12 tests nuevos en verde, suite completa **75 ficheros**, `tsc` en los 13
preexistentes.

**Sin marcar a propósito**: T0.3, porque el diagnóstico aún lleva credenciales por defecto en
vez de exigirlas por entorno; y T0.5, porque la línea base de suite y `type-check` no está
escrita en este Log, solo medida.


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
