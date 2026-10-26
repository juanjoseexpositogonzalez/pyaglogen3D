# Resilient token refresh

GitHub issue: **#122**. El gate de inicio es la etiqueta **`status:approved`** en esa issue.

## Why

La sesión se pierde sola. Un usuario que navega con normalidad acaba en la pantalla de inicio
de sesión sin haber hecho nada, y pierde el trabajo no guardado de la pantalla en la que
estaba.

Está medido, no supuesto. El token de acceso vive en memoria
(`frontend/src/lib/token-storage.ts`), así que **toda carga completa de página empieza sin
él**: las peticiones de datos salen sin autorización, reciben 401 a la vez, y cada una pide su
propio refresco (`frontend/src/lib/api.ts:82`).

Medición con sesión aislada por pantalla, build de producción, **8 corridas por escenario**:

| escenario | refrescos solapados a la vez | expulsiones |
| --- | --- | --- |
| detalle de proyecto | **5** | **6 de 8** |
| comparación | 2 | 1 de 8 |
| estudios batch, dashboard, proyectos | 1-3 | 0 de 8 |
| dos pestañas: una pesada y una ligera | 5 | **2 de 8** |
| dos pestañas: dos ligeras | 1 | 0 de 8 |

Estas cifras salen de `frontend/diagnostics/baseline-368b0e6.json`, el artefacto
versionado. Una versión anterior de esta tabla traía otros números: eran de una corrida
previa, tomada con el instrumento cuyos cuatro defectos este mismo documento describe.

El servidor rota el token de refresco en cada uso y deja el anterior en lista negra, que es una
defensa correcta contra el robo de credenciales. Con varios refrescos en vuelo, el primero gana
y los demás presentan un token ya invalidado: reciben 401.

Y entonces ocurre lo que convierte un tropiezo en una pérdida: **ante cualquier refresco
fallido se borran las credenciales** (`auth-api.ts:124`). Un 401 por colisión —transitorio,
recuperable, culpa de nuestra propia concurrencia— se trata igual que un token robado. No hay
reintento: se va a la pantalla de inicio de sesión.

El resultado es un sistema cuyo **mecanismo de recuperación es el que destruye la sesión**.

## What Changes

- **Un solo refresco en vuelo por pestaña.** Las peticiones que coinciden esperan al mismo
  refresco en lugar de pedir cada una el suyo. Es lo que la medición demuestra necesario.
- **Un refresco fallido deja de ser terminal.** Se distingue el fallo recuperable (el token
  presentado fue rotado por otro refresco) del definitivo (ausente, caducado o rechazado
  llevando el token vigente). Solo el segundo cierra la sesión.
- **El refresco deja de poder colgarse para siempre.** Hoy no tiene límite de espera; con una
  promesa compartida, un cuelgue dejaría esperando a toda la pestaña.
- **Cerrar sesión cancela lo que haya en vuelo**, para que un refresco que llega tarde no
  vuelva a escribir credenciales que el usuario acaba de retirar.
- **Un diagnóstico versionado y repetible**, con `--runs` y código de salida, para que «esto
  está arreglado» sea una cifra y no una impresión.

## Lo que NO entra, y por qué

**Un cerrojo entre pestañas.** Era la propuesta inicial y **la evidencia no la sostiene**: dos
pantallas ligeras simultáneas ni siquiera llegan a solapar sus refrescos y no fallan nunca
(0 de 8). El caso de pestaña pesada más ligera falla más que la pesada sola (3 de 8 frente a 1
de 8), pero ese aumento lo explican igual de bien las cinco colisiones internas de la pestaña
pesada, y el instrumento no puede atribuirlo.

Por eso se **secuencia en vez de especular**: primero se elimina la colisión dentro de la
pestaña, que sí está demostrada, y **se vuelve a medir**. Si entonces persisten expulsiones con
dos pestañas, el efecto entre pestañas existe y se aborda con datos propios. Añadir ahora un
cerrojo por origen sería complejidad permanente en el camino crítico de la autenticación,
justificada por una correlación que no hemos podido separar de su causa alternativa.

## Impact

- `frontend/src/lib/auth-api.ts` — donde nace el refresco (`:117`) y donde hoy se borran las
  credenciales (`:124`).
- `frontend/src/lib/api.ts` — **dos** puntos que reaccionan al 401 y redirigen a login
  (`:82`/`:89` y `:128`/`:133`). Arreglar solo uno deja el defecto vivo por el otro camino.
- `frontend/src/contexts/AuthContext.tsx` — refresca al montar y borra credenciales ante
  cualquier error (`:58`, `:64`).
- `frontend/diagnostics/` — el diagnóstico, nuevo y versionado.
- `frontend/package.json` — Playwright como dependencia de desarrollo, que el diagnóstico
  necesita y hoy no está declarada.

**Sin cambios en el backend.** La rotación con lista negra es correcta y se conserva.

**Sin cambios de interfaz.** Ninguna pantalla cambia de aspecto; cambia cuándo dejan de existir.
