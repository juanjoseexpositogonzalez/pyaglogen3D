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
- [x] T0.3 Documentar en el propio fichero cómo se ejecuta (build de producción, backend, un
      proyecto con varias simulaciones) y comprobar que **otra persona puede correrlo** sin
      ficheros de `/tmp` ni credenciales incrustadas.
- [x] T0.4 Registrar la línea base con **8 corridas por escenario** y **versionar su salida
      JSON** junto al diagnóstico, con la fecha y el commit medido. Sin artefacto versionado, el
      «antes» de T5.7 no es contrastable por quien revise el PR.
- [x] T0.5 Registrar suite y `type-check` de partida, para no confundir una regresión propia
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
- [x] T2.2 Implementar el límite de espera en `auth-api.ts`. **No con `AbortController`**,
      como decía esta tarea al escribirse: abortar no impide que el servidor procese la
      petición y rote el token, así que cancelar dejaría al cliente con una credencial intacta
      y ya inválida — convirtiendo una red lenta en una expulsión. Se acota **la espera**, no
      la petición.
- [x] T2.3 Comprobar el comportamiento tras el vencimiento. **La ranura se conserva hasta que
      la petición abandonada se asienta**, de modo que un llamador posterior espera en vez de
      emitir un segundo refresco con el mismo token.

      Esta tarea se escribió prometiendo lo contrario («el plazo no debe dejar la pestaña sin
      refresco posible»), y el contrato tenía la misma frase. **Es una contradicción real**: si
      la ranura se liberase al vencer, reaparecería la colisión que el change elimina. Se
      resuelve a favor de no reintroducir el defecto, y queda el residual escrito: si la
      petición **nunca** se asienta, la pestaña no vuelve a refrescar hasta recargar. No se ha
      observado, y cerrarlo pedía otro mecanismo que este contrato no incluye.

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

- [x] T5.1 Suite completa en verde; ningún test preexistente pasa a rojo.
- [x] T5.2 `npx tsc --noEmit` sin errores nuevos sobre la línea base de T0.5.
- [x] T5.3 `npm run build` en exit 0.
- [x] T5.4 Diagnóstico con **8 corridas por escenario**, contrastado contra el JSON de T0.4:
      de **9 expulsiones a 1**, artefacto en `after-fix-2026-10-25.json`.

      **El código de salida sigue siendo 1, a propósito.** La expulsión que queda es el caso
      entre pestañas que este contrato no cubre y que **#160** recoge con su evidencia. Dejar
      el gate en rojo es deliberado: pondría en verde algo que no está resuelto. Se cerrará
      cuando se cierre #160.
- [x] T5.5 **Volver a medir el par de dos pestañas** (R7). Registrar la cifra **y los solapes
      cruzados reales**. La coordinación entre pestañas se abre como trabajo propio **solo si
      queda alguna expulsión con causa `collision` en ese escenario**, no ante cualquier
      expulsión: una muerte posterior al arreglo puede venir del límite de espera de R3, que no
      tiene nada que ver con las pestañas. Y si los solapes cruzados siguen siendo 0, dejar
      escrito que **no se ha medido**, nunca que el cerrojo no haga falta.
- [x] T5.6 Verificación manual de acceso, cierre de sesión y sesión realmente caducada: el
      cambio está en el camino crítico de todo usuario.
- [x] T5.7 Registrar en el Log las cifras de antes y después, no la impresión.

## T6 — Entrega

- [x] T6.1 PR a `develop` enlazando #122, etiqueta `type:bug` (existe desde el 2026-10-25).
- [x] T6.2 Revisión adversarial antes del merge.
- [x] T6.3 Archive con sincronización canónica de `session-continuity`, **escribiendo el
      `Purpose`**: el tooling lo deja en `TBD` y ese hueco ya tiene issue abierta (#93).
- [x] T6.4 `state.yaml` actualizado.

## Log

<!-- Una entrada por tarea completada, con la evidencia que la respalda. -->

### L4 — Entrega: el judgment day encontró una regresión de seguridad mía (2026-10-26)

**El hallazgo crítico lo introduje cumpliendo el contrato.** R5 pide invalidar las credenciales
al entrar en `logout()`, y eso hice: el access token quedaba a `null` antes de la petición. Como
`authFetch` solo manda cabecera si hay token en memoria, el POST salía sin autenticar, el
servidor respondía 401 y **`token.blacklist()` nunca se ejecutaba**. Mi propio `catch` de
cortesía se tragaba el 401.

| | logout | refresh posterior |
| --- | --- | --- |
| con mi cambio | 401 | **200 — el token seguía vivo** |
| como estaba antes | 200 | 401 — revocado |

Con un refresco de **7 días**, un token robado antes de cerrar sesión servía una semana después.

Lo que esto enseña es más incómodo que un descuido: **el requisito, bien implementado, producía
el daño**. Un revisor que validara contra el contrato lo habría aprobado. Solo cazarlo pedía
ejecutar el cierre de sesión contra el servidor real y mirar si el token seguía sirviendo.

Y la comprobación que debía verlo estaba verde: la de camino crítico borraba credenciales a mano
en vez de pulsar el botón. Ahora pulsa el control real, exige 200 del servidor y comprueba que
el token previo ya no refresca. **Habría cazado esto desde el principio.**

**Resto de hallazgos**: generación de sesión comprobada al entrar en cada intento (un refresco
viejo podía hacer rotar el token de la sesión nueva y matarla); ranura liberada solo si sigue
siendo suya (una ejecución abandonada podía borrar la ranura de la sesión siguiente); una
aserción mía sobre el access token que **no probaba nada**, porque el test importaba el
almacenamiento de otra instancia de módulo; y tres rutas que el contrato nombraba sin testigo.

**Fuera de alcance, con issue propia**: #162 (los guardas de cinco páginas expulsan ante un 5xx)
y #164 (la revocación falla si el access token ya caducó, que es backend).

**Gates finales**: suite **79 ficheros**, `tsc` **13** preexistentes, build exit 0, camino
crítico **9/9**, diagnóstico **de 9 expulsiones a 1**.

**El código de salida del diagnóstico sigue siendo 1, a propósito**: la expulsión restante es el
caso entre pestañas de #160. Ponerlo en verde afirmaría algo que no es cierto.

### L3 — T5.6: el camino crítico, con lo que la comprobación NO cubre (2026-10-25)

El cambio vive en el camino que recorre todo usuario, así que se comprobó contra el navegador y
el backend reales, no solo con `fetch` doblado. El guion queda versionado en
`frontend/diagnostics/critical-path.mjs`.

| comprobación | resultado |
| --- | --- |
| acceso: la API responde 200 | OK |
| acceso: aterriza fuera de `/auth/login` | OK |
| acceso: cookie marcadora presente | OK |
| acceso: el dashboard carga con sesión | OK |
| sin credenciales, `/dashboard` manda a login | OK |
| un token inválido termina en login | OK |

**Lo que esto no demuestra, dicho antes de que alguien lo suponga.** La comprobación de cierre
**no ejercita `logout()`**: borra las credenciales a mano y observa la redirección. Verifica que
un navegador sin credenciales queda fuera, que no es lo mismo que verificar el cierre de sesión
con un refresco en vuelo. **Esa carrera la cubre el test unitario de R5**, que sí la provoca.

Llamar «cierre de sesión verificado» a lo que mide esta comprobación sería la clase de
afirmación que esta sesión lleva todo el día corrigiendo.

**Lo que sí añade sobre los tests unitarios**: la cookie que lee el middleware de rutas, la
redirección real, y el veredicto del servidor sobre un token que de verdad no vale. Los tres
solo participan en un navegador contra un backend.

**Y la mitad que no se ha debilitado**: un token genuinamente inválido sigue terminando la
sesión. Recuperarse de las colisiones no podía significar mantener viva una credencial revocada,
y no lo significa.

### L2 — T5: de 9 expulsiones a 1, y la que queda demuestra lo que no sabíamos (2026-10-25)

Ocho corridas por escenario, build de producción, contrastado contra la línea base versionada.

| escenario | antes | ahora |
| --- | --- | --- |
| detalle de proyecto | **6 de 8** | **0 de 8** |
| comparación | 1 de 8 | 0 de 8 |
| dos pestañas, pesada + ligera | 2 de 8 | 0 de 8 |
| dos pestañas, ligera + ligera | 0 de 8 | **1 de 8** |
| **total** | **9** | **1** |

**La colisión dentro de la pestaña está eliminada.** Era el defecto demostrado y ha desaparecido
de todos los escenarios donde se medía.

**Y entonces apareció lo que no se podía medir.** Con un solo refresco por pestaña, las ventanas
de las dos pestañas por fin coinciden: **`cruce` real en 5 de 8 corridas**, cuando antes de este
cambio fueron **0 en 16**. El experimento que no podía producir el efecto ahora sí lo produce.

En esos cruces se ve el reintento de R4 haciendo su trabajo: la pestaña presenta un token que la
otra acaba de rotar, recibe 401, relee el almacenamiento y **se recupera en 7 de los 8 casos**.
En el octavo el reintento también llega tarde y la sesión muere.

| corrida | cruce | refrescos t1 | rechazados | resultado |
| --- | --- | --- | --- | --- |
| c0, c4, c7 | 1 | 2 | 1 | recuperada |
| **c6** | 1 | 2 | 1 | **expulsada (`collision`)** |
| c1, c2, c3, c5 | 0 | 1 | 0 | sin cruce |

**Esto activa la condición de T5.5 tal cual estaba escrita**: queda una expulsión con causa
`collision` en el escenario de dos pestañas una vez eliminada la colisión interna, de modo que
la coordinación entre pestañas se abre **como trabajo propio y con evidencia propia**, no por
intuición.

Merece subrayarse por qué el contrato acertó al no decidirlo antes. El primer borrador afirmaba
que el cerrojo **no hacía falta**, apoyándose en un nulo que no probaba nada. La segunda
revisión obligó a degradarlo a «no lo sabemos». Hoy lo sabemos, y la respuesta es la contraria
de la que yo había escrito: **sí hace falta**, con 1 expulsión de cada 8 y un reintento que
absorbe el resto pero no todo.

Si aquella afirmación hubiera sobrevivido, este dato habría llegado como una sorpresa en
producción en vez de como una medición.

### L0b — Línea base de suite y type-check, escrita y no solo medida (2026-10-25)

Esta entrada existe porque T0.5 pedía **registrar** la línea base y durante casi todo el trabajo
estuvo medida pero sin escribir. Medir no es registrar: una cifra que solo vive en una consola
que ya se cerró no sirve para contrastar nada después.

Partida, sobre `develop` antes de tocar autenticación:

| gate | valor |
| --- | --- |
| suite (`--no-file-parallelism`) | **75 ficheros**, todos en verde |
| `npx tsc --noEmit` | **13** errores, los preexistentes de siempre |
| `npm run build` | exit 0 |

Tras el cambio: **77 ficheros** (los dos ficheros de test nuevos de T3 y T4 se suman a los de T1
y T2, que ya contaban), `tsc` **13**, build exit 0.

Los 13 errores siguen siendo los mismos tres ficheros ajenos a este trabajo
(`BatchProjectionExportPanel.test.tsx`, `NetworkCanvas.test.tsx`, `projection-grid.test.ts`).

**Intermitencia ajena conocida**: `FraktalBatchImageDetail.test.tsx` y `FraktalBatchUpload.test.tsx`
fallan ~1 de cada 5 corridas en serie. No es de este change, pero conviene tenerlo escrito aquí
para que un rojo suelto no se confunda con una regresión propia.

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
