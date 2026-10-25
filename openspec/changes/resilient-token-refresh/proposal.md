# Resilient token refresh

GitHub issue: **#122**. Jira: pendiente de abrir al aprobar.

## Why

La sesión se pierde sola. Un usuario que navega con normalidad acaba en la pantalla de
inicio de sesión sin haber hecho nada, y pierde el trabajo no guardado de la pantalla en la
que estaba.

No es una hipótesis: está medido. Con el token de acceso recién perdido —lo que ocurre en
**cada carga completa de página**, porque se guarda en memoria— todas las peticiones de datos
salen sin autorización, reciben 401 a la vez, y **cada una pide un refresco por su cuenta**.

| escenario medido | refrescos concurrentes | expulsiones |
| --- | --- | --- |
| una pestaña, pantalla de detalle de proyecto | **5** | **1 de cada 3 cargas** |
| dos pestañas abiertas a la vez | 5 y 1 | **2 de cada 3 intentos** |

El servidor rota el token de refresco en cada uso y deja el anterior en lista negra, que es una
defensa correcta contra el robo de credenciales. Con varias peticiones en vuelo, la primera
gana y las demás presentan un token ya invalidado: reciben 401.

Y entonces ocurre lo que convierte un tropiezo en una pérdida: **ante cualquier refresco
fallido se borran las credenciales**. Un 401 por colisión —transitorio, recuperable, culpa de
nuestra propia concurrencia— se trata igual que un token robado o caducado. No hay reintento:
se va a la pantalla de inicio de sesión.

El resultado es un sistema cuyo **mecanismo de recuperación es el que destruye la sesión**.

El fallo empeora cuanto más rica es la pantalla: cuantas más peticiones concurrentes dispara
una vista, más probable es la colisión. Las pantallas donde el usuario tiene más trabajo que
perder son las que más lo expulsan.

## What Changes

- **Un solo refresco en vuelo por pestaña.** Las peticiones que coinciden esperan al mismo
  refresco en lugar de pedir cada una el suyo.
- **Coordinación entre pestañas.** El punto anterior no basta: dos pestañas no comparten
  memoria y es el caso que más falla de los dos medidos. Hace falta un cerrojo compartido por
  origen, con un camino de respaldo donde no exista.
- **Un refresco fallido deja de ser terminal.** Se distingue el fallo recuperable (colisión
  con otro refresco) del definitivo (token caducado, revocado o ausente). Solo el segundo
  cierra la sesión.
- **Un diagnóstico que se puede volver a ejecutar**, versionado con el cambio, para que la
  afirmación «esto está arreglado» sea comprobable por cualquiera y no una impresión.

## Impact

- `frontend/src/lib/auth-api.ts` — dónde nace el refresco y dónde hoy se borran las credenciales.
- `frontend/src/lib/api.ts` — el punto que reacciona al 401 y que hoy redirige a login.
- `frontend/src/lib/token-storage.ts` — custodia de los tokens.
- `frontend/src/contexts/AuthContext.tsx` — el refresco al montar.
- `frontend/scripts/diagnostics/` — el diagnóstico de Fase 0, nuevo.

**Sin cambios en el backend.** La configuración de rotación con lista negra es correcta y se
conserva: relajarla debilitaría la seguridad para tapar un defecto de concurrencia del cliente.

**Sin cambios de interfaz.** Ninguna pantalla cambia de aspecto; cambia cuándo dejan de existir.
