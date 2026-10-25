# Design — Resilient token refresh

## Fase 0: lo que se midió antes de decidir

Diagnóstico versionado en `frontend/diagnostics/refresh-storm.mjs`. Build de producción,
backend real, **sesión aislada por pantalla** (contexto y acceso nuevos para cada una),
**8 corridas por escenario**.

Mide tres cosas que una lectura de consola no da:

1. **Solapamiento real en vuelo**, no «peticiones vistas en cuatro segundos». Son afirmaciones
   distintas y solo la primera sostiene la palabra «concurrente».
2. **Colisión frente a cascada**: una pestaña que muere sin ningún refresco rechazado propio no
   colisionó, la mató otra al borrar el token compartido. Tienen arreglos distintos.
3. Lo anterior **repetido**, porque el fallo es probabilístico.

| escenario | solapamiento máximo | expulsiones | causa |
| --- | --- | --- | --- |
| detalle de proyecto | **5** | 1 de 8 | colisión |
| estudios batch | 3 | 1 de 8 | colisión |
| comparación / dashboard / proyectos | 1-2 | 0 de 8 | — |
| dos pestañas, pesada + ligera | 5 | 3 de 8 | colisión |
| dos pestañas, ligera + ligera | **1** | 0 de 8 | — |

**Cascada: cero en todos los escenarios.** La hipótesis alternativa —que las muertes se
explicaran por el borrado destructivo propagándose entre pestañas— queda descartada con datos.

### Dos correcciones del instrumento, ambas necesarias

La primera versión **compartía sesión entre pantallas**: tras la primera expulsión, las filas
siguientes medían el cadáver y no la pantalla. La segunda **ignoraba las rutas** que decía
comparar, de modo que las dos «parejas» de pestañas ejecutaban el mismo experimento; un
resultado de 0 de 6 que parecía concluyente era ruido.

Lo detectó una cifra que no se podía explicar —un solapamiento de 5 donde como mucho cabían
2—, no una relectura del código. Queda como regla: **una cifra que no se sabe explicar no es
evidencia**, por mucho que apunte en la dirección esperada.

## Decisiones

### D1. El arreglo es del cliente; el backend no se toca

`ROTATE_REFRESH_TOKENS` con `BLACKLIST_AFTER_ROTATION` limita la ventana de uso de un token
robado. El defecto no es que el servidor invalide el token anterior, sino que **el cliente
presente el mismo token cinco veces a la vez**.

Alternativa descartada: desactivar rotación o lista negra. Cambia seguridad real por un defecto
de concurrencia propio.

### D2. Coalescencia dentro de la pestaña, y nada más por ahora

**Lo que la evidencia sostiene**: las colisiones internas existen y expulsan. Una única promesa
compartida en vuelo las elimina.

**Lo que la evidencia NO sostiene**: que haga falta coordinar entre pestañas. Dos pantallas
ligeras no llegan a solapar refrescos (`crossOverlap ≤ 1`) y no fallan. El par pesada + ligera
falla más que la pesada sola, pero las cinco colisiones internas de la pesada explican ese
aumento igual de bien, y el instrumento no puede separar ambas causas.

**Por tanto se secuencia**: se elimina la colisión interna, se vuelve a medir el par pesada +
ligera, y solo si persisten expulsiones se abre el trabajo de coordinación entre pestañas, ya
con su propia evidencia. Un cerrojo por origen es complejidad permanente en el camino crítico
de la autenticación: no se paga por una correlación sin aislar.

### D3. Un 401 de refresco no prueba que la sesión haya terminado

Hoy cualquier fallo borra las credenciales (`auth-api.ts:124`). La distinción:

- **Recuperable**: el token presentado fue rotado por otro refresco. El vigente está en el
  almacenamiento; basta releerlo y reintentar **una vez**.
- **Definitivo**: no hay token, o el reintento con el token vigente también es rechazado.

El reintento acotado a uno es deliberado: más convierte un fallo de credenciales en un bucle, y
mantener viva una sesión que debe morir es una debilidad de autenticación, no una mejora.

### D4. La espera tiene que estar acotada

`authApi.refreshToken` hace `fetch` sin límite de tiempo (`auth-api.ts:117`). Hoy cada petición
se cuelga por su cuenta; **con una promesa compartida, un cuelgue dejaría esperando a toda la
pestaña**. El arreglo introduce ese riesgo, así que debe traer su límite: vencido el plazo, la
espera termina con error reintentable y **sin tocar las credenciales**.

### D5. Cerrar sesión invalida lo que esté en vuelo

`logout()` borra los tokens (`auth-api.ts:104`), pero un refresco en curso los vuelve a
escribir al responder (`:129`, `:133`), y escribir el de refresco repone la cookie que el
middleware mira. El usuario quedaría autenticado tras pedir salir. Una promesa compartida
alarga esa ventana, así que el cambio **debe** cerrarla: un refresco cuyo resultado llega
después de un cierre de sesión se descarta.

### D6. Los dos caminos del 401, no uno

`api.ts` repite el manejo del 401 en dos sitios (`:82`/`:89` y `:128`/`:133`). Arreglar uno
solo deja el defecto vivo por el otro.

## Qué se puede testear y qué no

| escenario | medio | por qué |
| --- | --- | --- |
| coalescencia, clasificación de fallos, cierre de sesión, espera acotada | **vitest** | lógica pura con `fetch` doblado |
| carga completa de página, varias pestañas | **diagnóstico de navegador** | jsdom es un único grafo de módulos y no tiene contextos de navegación reales |

Los escenarios del segundo grupo se marcan `[manual]` y se respaldan con el diagnóstico. Son
los que más importan, así que decirlo es obligatorio: **no hay testigo automático en la suite
para el comportamiento central**, y por eso el diagnóstico es parte del contrato.

## Riesgos

- **Un solo pase verde no demuestra nada.** Los escenarios fallan entre 1 y 3 de cada 8: una
  verificación de una pasada puede salir limpia con el defecto intacto.
- **El cambio está en el camino crítico de todo usuario.** Acceso, cierre de sesión y sesión
  realmente caducada se verifican a mano antes de entregar.
- **La coalescencia mal implementada bloquea la aplicación**: si la promesa compartida no se
  limpia al terminar, el primer fallo deja a la pestaña sin poder refrescar nunca más.

## Fuera de alcance

- Cualquier cambio en `SIMPLE_JWT` o en el backend.
- Sacar el token de acceso de memoria: es una decisión de seguridad con su propio análisis.
- Avisar al usuario antes de expulsarlo y preservar su trabajo en curso.
- Coordinación entre pestañas, hasta que haya evidencia propia que la justifique (D2).
