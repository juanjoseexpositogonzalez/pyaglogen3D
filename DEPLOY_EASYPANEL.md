# Deploy en Easypanel / VPS

Guía mínima para este branch (`build/easypanel-deploy`) usando `docker-compose.prod.yml`.

## 1. Crear los archivos reales de entorno

Estos archivos NO se versionan y SON obligatorios:

- `backend/.env`
- `frontend/.env`

```bash
cp backend/.env.template backend/.env
cp frontend/.env.template frontend/.env
```

### Importante

- `backend/.env` lo consumen `db`, `backend`, `worker` y `beat`.
- `frontend/.env` se usa en build-time para Next.js. Si cambiás `NEXT_PUBLIC_API_URL`, tenés que reconstruir la imagen del frontend.

Si vas a levantar con Docker Compose en la VPS, exportá primero ambas variables de entorno para que Compose también pueda interpolar `NEXT_PUBLIC_API_URL` durante el build:

```bash
set -a
. backend/.env
. frontend/.env
set +a
docker compose -f docker-compose.prod.yml up -d --build
```

## 2. Variables mínimas

### `backend/.env`

Verificá especialmente:

- `SECRET_KEY`
- `DATABASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `CORS_ORIGINS`
- `FRONTEND_URL`

`DATABASE_URL` debe coincidir con las credenciales `POSTGRES_*` del mismo archivo.

### `frontend/.env`

Variable clave:

- `NEXT_PUBLIC_API_URL`

Ejemplos válidos:

- Subdominios separados: `https://api.tudominio.com/api/v1`
- Mismo dominio con proxy por path: `https://app.tudominio.com/api/v1`

## 3. Routing / proxy esperado

### Opción recomendada: subdominios separados

- Frontend → `frontend:3000`
- Backend API → `backend:8080`

Ejemplo público:

- `https://app.tudominio.com` → servicio frontend
- `https://api.tudominio.com` → servicio backend
- `NEXT_PUBLIC_API_URL=https://api.tudominio.com/api/v1`

### Opción alternativa: mismo dominio con path proxy

- `/` → frontend
- `/api/` → backend
- `NEXT_PUBLIC_API_URL=https://app.tudominio.com/api/v1`

Si usás esta opción, el proxy de Easypanel/Nginx tiene que reenviar `/api/` al backend sin romper el prefijo.

## 4. Primer deploy: migraciones

Después del primer `up -d --build`, corré migraciones antes de dar por válido el deploy:

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
```

Opcional:

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

## 5. Nota sobre healthcheck del backend

La imagen del backend trae un `HEALTHCHECK` hacia `/api/v1/health/`, pero esa ruta no existe hoy en Django. En este compose se desactiva explícitamente para evitar falsos negativos en Easypanel/VPS.
