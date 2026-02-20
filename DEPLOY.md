# Deployment Guide

This guide covers deploying pyAgloGen3D to production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Docker Deployment](#docker-deployment)
- [Manual Deployment](#manual-deployment)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Celery Workers](#celery-workers)
- [Nginx Configuration](#nginx-configuration)
- [SSL/TLS Setup](#ssltls-setup)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **CPU**: 4+ cores recommended (simulations are CPU-intensive)
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 50GB+ for simulation data and geometry storage
- **OS**: Ubuntu 22.04 LTS or similar Linux distribution

### Software Requirements

- Docker 24+ and Docker Compose v2
- Or for manual deployment:
  - Python 3.11+
  - Rust 1.70+ (for building aglogen_core)
  - Node.js 18+ (for frontend)
  - PostgreSQL 15+
  - Redis 7+
  - Nginx (reverse proxy)

## Docker Deployment

### Quick Start

```bash
# Clone repository
git clone https://github.com/juanjoseexpositogonzalez/pyaglogen3D.git
cd pyaglogen3D

# Create production environment file
cp .env.example .env
# Edit .env with production values (see Environment Variables section)

# Build and start all services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Run migrations
docker compose exec backend python manage.py migrate

# Collect static files
docker compose exec backend python manage.py collectstatic --noinput
```

### Production Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    environment:
      - DEBUG=False
      - DJANGO_SETTINGS_MODULE=config.settings.production
    restart: always
    depends_on:
      - db
      - redis

  celery:
    build:
      context: .
      dockerfile: backend/Dockerfile
    command: celery -A config worker -l info --concurrency=4
    environment:
      - DEBUG=False
      - DJANGO_SETTINGS_MODULE=config.settings.production
    restart: always
    depends_on:
      - db
      - redis

  celery-beat:
    build:
      context: .
      dockerfile: backend/Dockerfile
    command: celery -A config beat -l info
    environment:
      - DEBUG=False
    restart: always
    depends_on:
      - redis

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        - NEXT_PUBLIC_API_URL=https://your-domain.com/api/v1
    restart: always

  db:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    restart: always

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: always

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - static_files:/var/www/static:ro
    depends_on:
      - backend
      - frontend
    restart: always

volumes:
  postgres_data:
  redis_data:
  static_files:
```

## Manual Deployment

### 1. System Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3.11 python3.11-venv python3.11-dev \
    postgresql postgresql-contrib redis-server nginx \
    build-essential pkg-config libssl-dev curl git

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Application Setup

```bash
# Create application user
sudo useradd -m -s /bin/bash pyaglogen
sudo su - pyaglogen

# Clone repository
git clone https://github.com/juanjoseexpositogonzalez/pyaglogen3D.git
cd pyaglogen3D

# Create virtual environment
python3.11 -m venv .venv
source .venv/bin/activate

# Install Python dependencies
cd backend
pip install --upgrade pip
pip install -e ".[prod]"

# Build Rust engine
cd ../aglogen_core
maturin build --release
pip install target/wheels/*.whl

# Build frontend
cd ../frontend
npm ci
npm run build
```

### 3. Configure Environment

```bash
cd ~/pyaglogen3D
cp .env.example .env
nano .env  # Edit with production values
```

### 4. Database Setup

```bash
# Create database and user
# IMPORTANT: Replace <SECURE_PASSWORD> with a strong, unique password
# Store this password securely and use it in your .env file
sudo -u postgres psql <<EOF
CREATE USER pyaglogen WITH PASSWORD '<SECURE_PASSWORD>';
CREATE DATABASE pyaglogen3d OWNER pyaglogen;
GRANT ALL PRIVILEGES ON DATABASE pyaglogen3d TO pyaglogen;
EOF

# Run migrations
cd ~/pyaglogen3D/backend
source ../.venv/bin/activate
python manage.py migrate
python manage.py collectstatic --noinput
```

### 5. Systemd Services

Create `/etc/systemd/system/pyaglogen-backend.service`:

```ini
[Unit]
Description=pyAgloGen3D Django Backend
After=network.target postgresql.service redis.service

[Service]
User=pyaglogen
Group=pyaglogen
WorkingDirectory=/home/pyaglogen/pyaglogen3D/backend
Environment="PATH=/home/pyaglogen/pyaglogen3D/.venv/bin"
ExecStart=/home/pyaglogen/pyaglogen3D/.venv/bin/gunicorn \
    --workers 4 \
    --bind unix:/run/pyaglogen/backend.sock \
    --timeout 120 \
    config.wsgi:application
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/pyaglogen-celery.service`:

```ini
[Unit]
Description=pyAgloGen3D Celery Worker
After=network.target postgresql.service redis.service

[Service]
User=pyaglogen
Group=pyaglogen
WorkingDirectory=/home/pyaglogen/pyaglogen3D/backend
Environment="PATH=/home/pyaglogen/pyaglogen3D/.venv/bin"
ExecStart=/home/pyaglogen/pyaglogen3D/.venv/bin/celery \
    -A config worker \
    -l info \
    --concurrency=4
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/pyaglogen-frontend.service`:

```ini
[Unit]
Description=pyAgloGen3D Next.js Frontend
After=network.target

[Service]
User=pyaglogen
Group=pyaglogen
WorkingDirectory=/home/pyaglogen/pyaglogen3D/frontend
ExecStart=/usr/bin/npm start
Environment="PORT=3000"
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start services:

```bash
sudo mkdir -p /run/pyaglogen
sudo chown pyaglogen:pyaglogen /run/pyaglogen

sudo systemctl daemon-reload
sudo systemctl enable pyaglogen-backend pyaglogen-celery pyaglogen-frontend
sudo systemctl start pyaglogen-backend pyaglogen-celery pyaglogen-frontend
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DEBUG` | Enable debug mode | `False` |
| `SECRET_KEY` | Django secret key | `your-secure-random-key` |
| `ALLOWED_HOSTS` | Comma-separated hostnames | `your-domain.com,www.your-domain.com` |
| `DATABASE_URL` | PostgreSQL connection URL | `postgres://user:pass@localhost:5432/pyaglogen3d` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379/0` |
| `CELERY_BROKER_URL` | Celery broker URL | `redis://localhost:6379/1` |
| `CORS_ALLOWED_ORIGINS` | CORS origins | `https://your-domain.com` |

### Generate Secret Key

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

## Database Setup

### PostgreSQL Configuration

Edit `/etc/postgresql/15/main/postgresql.conf`:

```ini
# Performance tuning for simulation workloads
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 256MB
maintenance_work_mem = 512MB
max_connections = 100
```

### Backup Strategy

```bash
# Create backup script
cat > /home/pyaglogen/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/home/pyaglogen/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Database backup
pg_dump pyaglogen3d | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# Keep only last 7 days
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
EOF

chmod +x /home/pyaglogen/backup.sh

# Add to crontab
echo "0 2 * * * /home/pyaglogen/backup.sh" | crontab -
```

## Celery Workers

### Worker Configuration

For CPU-intensive simulations, configure workers appropriately:

```bash
# Single worker with multiple processes
celery -A config worker -l info --concurrency=4

# Or use prefork pool for better isolation
celery -A config worker -l info --pool=prefork --concurrency=4
```

### Monitoring with Flower

```bash
pip install flower
celery -A config flower --port=5555
```

## Nginx Configuration

Create `/etc/nginx/sites-available/pyaglogen`:

```nginx
upstream backend {
    server unix:/run/pyaglogen/backend.sock fail_timeout=0;
}

upstream frontend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    client_max_body_size 50M;

    # API requests
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # Admin
    location /admin/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static files
    location /static/ {
        alias /home/pyaglogen/pyaglogen3D/backend/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Frontend
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/pyaglogen /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## SSL/TLS Setup

### Using Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal is configured automatically
sudo systemctl status certbot.timer
```

## Monitoring

### Health Checks

```bash
# Backend health
curl -f http://localhost:8000/api/v1/health/ || echo "Backend unhealthy"

# Celery health
celery -A config inspect ping

# Redis health
redis-cli ping
```

### Log Locations

- Backend: `/var/log/pyaglogen/backend.log`
- Celery: `/var/log/pyaglogen/celery.log`
- Nginx: `/var/log/nginx/access.log`, `/var/log/nginx/error.log`

### Performance Monitoring

Consider adding:
- **Sentry** for error tracking
- **Prometheus + Grafana** for metrics
- **pgAdmin** for database monitoring

## Troubleshooting

### Common Issues

**Migrations fail:**
```bash
# Check database connection
python manage.py dbshell

# Reset migrations if needed (CAUTION: data loss)
python manage.py migrate --fake-initial
```

**Celery tasks stuck:**
```bash
# Check Redis
redis-cli LLEN celery

# Purge all tasks (CAUTION)
celery -A config purge

# Restart workers
sudo systemctl restart pyaglogen-celery
```

**Rust module not found:**
```bash
# Rebuild aglogen_core
cd aglogen_core
maturin develop --release
```

**Static files not loading:**
```bash
python manage.py collectstatic --noinput
sudo systemctl reload nginx
```

### Performance Tuning

**For large parametric studies:**
```bash
# Increase Celery concurrency
celery -A config worker -l info --concurrency=8

# Or use multiple workers
celery -A config worker -l info -n worker1@%h --concurrency=4 &
celery -A config worker -l info -n worker2@%h --concurrency=4 &
```

**Database optimization:**
```sql
-- Add indexes for common queries
CREATE INDEX idx_simulation_project_status ON simulations_simulation(project_id, status);
CREATE INDEX idx_parametric_study_status ON simulations_parametricstudy(status);

-- Vacuum and analyze
VACUUM ANALYZE;
```

## Updates and Maintenance

### Updating the Application

```bash
cd ~/pyaglogen3D
git pull origin main

# Update dependencies
source .venv/bin/activate
pip install -e ".[prod]"

# Rebuild Rust engine if changed
cd aglogen_core
maturin build --release
pip install target/wheels/*.whl --force-reinstall

# Run migrations
cd ../backend
python manage.py migrate
python manage.py collectstatic --noinput

# Restart services
sudo systemctl restart pyaglogen-backend pyaglogen-celery

# Update frontend
cd ../frontend
npm ci
npm run build
sudo systemctl restart pyaglogen-frontend
```

### Rollback Procedure

```bash
# Revert to previous version
git checkout <previous-commit-hash>

# Restore database backup if needed
gunzip < backups/db_YYYYMMDD_HHMMSS.sql.gz | psql pyaglogen3d

# Rebuild and restart
# ... follow update steps above
```
