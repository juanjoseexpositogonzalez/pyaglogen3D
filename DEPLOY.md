# Deployment Guide

This guide covers deploying pyAgloGen3D to production using **Heroku** (frontend) and **Fly.io** (backend).

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Backend Deployment (Fly.io)](#backend-deployment-flyio)
- [Frontend Deployment (Heroku)](#frontend-deployment-heroku)
- [Domain & SSL Configuration](#domain--ssl-configuration)
- [CI/CD Integration](#cicd-integration)
- [Monitoring & Logging](#monitoring--logging)
- [Troubleshooting](#troubleshooting)
- [Cost Estimation](#cost-estimation)

---

## Architecture Overview

```
┌─────────────────────┐         ┌────────────────────────────────────────┐
│      HEROKU         │         │               FLY.IO                    │
│                     │         │                                         │
│  ┌───────────────┐  │  HTTPS  │  ┌───────────┐    ┌─────────────────┐  │
│  │   Next.js     │──┼────────▶│  │  Django   │    │  Celery Worker  │  │
│  │   Frontend    │  │         │  │    API    │    │ (aglogen_core)  │  │
│  │   (Port 80)   │  │         │  │ (Port 8080)│    │                 │  │
│  └───────────────┘  │         │  └─────┬─────┘    └────────┬────────┘  │
│                     │         │        │                    │           │
└─────────────────────┘         │  ┌─────▼─────┐    ┌────────▼────────┐  │
                                │  │    Fly    │    │  Upstash Redis  │  │
                                │  │  Postgres │    │ (Celery Broker) │  │
                                │  └───────────┘    └─────────────────┘  │
                                └────────────────────────────────────────┘
```

**Services:**
- **Frontend (Heroku)**: Next.js 14 application
- **Backend API (Fly.io)**: Django 5.0 + Django REST Framework
- **Background Worker (Fly.io)**: Celery with aglogen_core Rust engine
- **Database (Fly.io)**: Fly Postgres (managed PostgreSQL)
- **Cache/Broker (Fly.io)**: Upstash Redis (serverless Redis)

---

## Prerequisites

### Accounts Required

1. **Fly.io Account**: https://fly.io/app/sign-up (credit card required for resources)
2. **Heroku Account**: https://signup.heroku.com (credit card required for paid dynos)

### CLI Tools

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

# Install Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh
heroku login
```

### Local Requirements

- Git
- Python 3.11+ (for generating secrets)
- Node.js 18+ (optional, for local testing)

---

## Backend Deployment (Fly.io)

### Step 1: Clone and Prepare

```bash
git clone https://github.com/juanjoseexpositogonzalez/pyaglogen3D.git
cd pyaglogen3D
```

### Step 2: Create Fly.io Application

```bash
# Initialize Fly app (from project root)
fly launch --name pyaglogen3d-api --no-deploy --region mad

# Choose region closest to your users:
# - mad (Madrid)
# - cdg (Paris)
# - lhr (London)
# - iad (Virginia)
# - sjc (San Jose)
```

### Step 3: Create PostgreSQL Database

```bash
# Create Fly Postgres cluster
fly postgres create --name pyaglogen3d-db --region mad

# Attach to your app (auto-sets DATABASE_URL)
fly postgres attach pyaglogen3d-db --app pyaglogen3d-api
```

**Postgres Pricing:**
| Plan | RAM | Storage | Price |
|------|-----|---------|-------|
| Development | 256MB | 1GB | Free |
| Production | 2GB | 10GB | ~$15/month |

### Step 4: Create Upstash Redis

```bash
# Create Redis instance
fly redis create --name pyaglogen3d-redis --region mad

# This outputs a REDIS_URL - save it!
```

**Alternative**: Use [Upstash Console](https://console.upstash.com) for more control.

### Step 5: Configure Secrets

```bash
# Generate Django secret key
SECRET_KEY=$(python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())")

# Set all secrets
fly secrets set \
  SECRET_KEY="$SECRET_KEY" \
  DEBUG="False" \
  ALLOWED_HOSTS="pyaglogen3d-api.fly.dev" \
  REDIS_URL="<your-redis-url-from-step-4>" \
  CORS_ORIGINS="https://pyaglogen3d-frontend.herokuapp.com"

# Verify secrets are set
fly secrets list
```

### Step 6: Deploy

```bash
# Deploy the application
fly deploy

# Watch deployment logs
fly logs
```

**First deployment takes 5-10 minutes** due to Rust compilation.

### Step 7: Run Migrations

```bash
# SSH into the container and run migrations
fly ssh console -C "python manage.py migrate"

# Create superuser (optional)
fly ssh console -C "python manage.py createsuperuser"
```

### Step 8: Scale Celery Worker

```bash
# Start the worker process
fly scale count worker=1

# For higher throughput
fly scale count worker=2

# Check running machines
fly status
```

### Step 9: Verify Deployment

```bash
# Check health endpoint
curl https://pyaglogen3d-api.fly.dev/api/v1/health/

# Check logs
fly logs --app pyaglogen3d-api

# Check worker logs specifically
fly logs --app pyaglogen3d-api -p worker
```

---

## Frontend Deployment (Heroku)

### Step 1: Create Heroku Application

```bash
cd pyaglogen3D/frontend

# Create Heroku app
heroku create pyaglogen3d-frontend

# Set Node.js buildpack
heroku buildpacks:set heroku/nodejs
```

### Step 2: Configure Environment Variables

```bash
# Set API URL to point to Fly.io backend
heroku config:set NEXT_PUBLIC_API_URL=https://pyaglogen3d-api.fly.dev/api/v1

# Set production mode
heroku config:set NODE_ENV=production

# Verify configuration
heroku config
```

### Step 3: Configure Node.js Version

Add to `frontend/package.json`:

```json
{
  "engines": {
    "node": "18.x",
    "npm": "10.x"
  }
}
```

### Step 4: Deploy to Heroku

**Option A: Deploy from subdirectory (monorepo)**

```bash
# From project root
git subtree push --prefix frontend heroku main
```

**Option B: Deploy with separate Git remote**

```bash
# Add Heroku remote for frontend subdirectory
cd frontend
git init
git add .
git commit -m "Initial frontend deployment"
heroku git:remote -a pyaglogen3d-frontend
git push heroku main
```

**Option C: Use GitHub integration**

1. Go to Heroku Dashboard → Your App → Deploy
2. Connect GitHub repository
3. Set "App root" to `frontend`
4. Enable automatic deploys from `main` branch

### Step 5: Verify Deployment

```bash
# Open the app
heroku open

# Check logs
heroku logs --tail

# Check dyno status
heroku ps
```

---

## Domain & SSL Configuration

### Custom Domain for Fly.io (Backend)

```bash
# Add custom domain
fly certs add api.yourdomain.com

# Get DNS records
fly certs show api.yourdomain.com

# Add these DNS records to your domain provider:
# - CNAME: api → pyaglogen3d-api.fly.dev
# OR
# - A record: api → <fly-ipv4>
# - AAAA record: api → <fly-ipv6>
```

### Custom Domain for Heroku (Frontend)

```bash
# Add custom domain
heroku domains:add www.yourdomain.com
heroku domains:add yourdomain.com

# Get DNS target
heroku domains

# Add these DNS records:
# - CNAME: www → <heroku-dns-target>
# - ALIAS/ANAME: @ → <heroku-dns-target>
```

### Update CORS After Custom Domain

```bash
fly secrets set CORS_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"
```

### Update Frontend API URL

```bash
heroku config:set NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api/v1
```

---

## CI/CD Integration

### GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Fly CLI
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Heroku
        uses: akhileshns/heroku-deploy@v3.13.15
        with:
          heroku_api_key: ${{ secrets.HEROKU_API_KEY }}
          heroku_app_name: pyaglogen3d-frontend
          heroku_email: ${{ secrets.HEROKU_EMAIL }}
          appdir: frontend
```

### Get API Tokens

```bash
# Fly.io token
fly tokens create deploy -x 999999h
# Add to GitHub Secrets as FLY_API_TOKEN

# Heroku token
heroku auth:token
# Add to GitHub Secrets as HEROKU_API_KEY
```

---

## Monitoring & Logging

### Fly.io Monitoring

```bash
# Real-time logs
fly logs

# Specific process logs
fly logs -p web
fly logs -p worker

# SSH into container for debugging
fly ssh console

# Check machine status
fly status

# View metrics dashboard
fly dashboard
```

### Heroku Monitoring

```bash
# Real-time logs
heroku logs --tail

# Check dyno status
heroku ps

# Run one-off commands
heroku run bash
```

### Health Check Endpoints

```bash
# Backend health
curl https://pyaglogen3d-api.fly.dev/api/v1/health/

# Expected response:
# {"status": "healthy", "database": "connected", "redis": "connected"}
```

### Recommended Monitoring Tools

1. **Sentry** - Error tracking (free tier available)
   ```bash
   fly secrets set SENTRY_DSN="https://xxx@sentry.io/xxx"
   ```

2. **Fly Metrics** - Built-in metrics at https://fly.io/apps/pyaglogen3d-api/metrics

3. **Heroku Metrics** - Built-in at Heroku Dashboard → Metrics

---

## Troubleshooting

### Fly.io Issues

#### Deployment fails during Rust build

**Symptom**: Build times out or runs out of memory

**Solution**:
```bash
# Increase build machine resources
fly deploy --build-arg CARGO_NET_RETRY=5 --vm-size shared-cpu-2x

# Or pre-build the wheel locally and include in repo
cd aglogen_core
maturin build --release
# Commit the .whl file
```

#### Database connection errors

**Symptom**: `psycopg.OperationalError: connection refused`

**Solution**:
```bash
# Check if DATABASE_URL is set
fly secrets list | grep DATABASE

# Verify Postgres is running
fly postgres connect -a pyaglogen3d-db

# Re-attach database
fly postgres attach pyaglogen3d-db --app pyaglogen3d-api
```

#### Celery worker not processing tasks

**Symptom**: Tasks stuck in queue

**Solution**:
```bash
# Check worker is running
fly status

# Check worker logs
fly logs -p worker

# Verify REDIS_URL is correct
fly ssh console -C "echo \$REDIS_URL"

# Restart worker
fly scale count worker=0
fly scale count worker=1
```

#### Out of memory errors

**Symptom**: `OOMKilled` in logs

**Solution**:
```bash
# Scale up VM memory
fly scale memory 1024 -p web
fly scale memory 2048 -p worker

# Or reduce Celery concurrency in fly.toml
# worker = "celery -A config worker -l info --concurrency=1"
```

#### Machine keeps stopping

**Symptom**: App returns 503 errors intermittently

**Solution**:
```bash
# Check if auto-stop is too aggressive
# In fly.toml, set:
# min_machines_running = 1

# Force machine to stay running
fly scale count web=1 --max-per-region 1
```

### Heroku Issues

#### Build fails

**Symptom**: `npm ERR!` during build

**Solution**:
```bash
# Clear build cache
heroku builds:cache:purge -a pyaglogen3d-frontend

# Check Node.js version in package.json
# Ensure "engines": { "node": "18.x" }

# View build logs
heroku builds:output
```

#### API connection errors (CORS)

**Symptom**: `Access-Control-Allow-Origin` errors in browser console

**Solution**:
```bash
# Update CORS settings on backend
fly secrets set CORS_ORIGINS="https://pyaglogen3d-frontend.herokuapp.com"

# Redeploy backend
fly deploy
```

#### Static assets not loading

**Symptom**: CSS/JS files return 404

**Solution**:
```bash
# Ensure build completed successfully
heroku logs --tail

# Check if .next directory was created
heroku run ls -la .next

# Force rebuild
git commit --allow-empty -m "Force rebuild"
git push heroku main
```

#### Dyno sleeping (Eco tier)

**Symptom**: First request is slow (30+ seconds)

**Solution**:
```bash
# Upgrade to Basic dyno ($7/month)
heroku ps:type basic

# Or use a free uptime monitor like UptimeRobot
# to ping your app every 25 minutes
```

### Common Issues (Both Platforms)

#### Migrations fail

**Symptom**: `django.db.utils.ProgrammingError`

**Solution**:
```bash
# Fly.io
fly ssh console -C "python manage.py showmigrations"
fly ssh console -C "python manage.py migrate --fake-initial"

# Check for unapplied migrations
fly ssh console -C "python manage.py migrate --plan"
```

#### Environment variables not loading

**Symptom**: `KeyError` or `decouple.UndefinedValueError`

**Solution**:
```bash
# Fly.io - check secrets
fly secrets list

# Heroku - check config vars
heroku config

# Ensure variable names match exactly
```

---

## Cost Estimation

### Fly.io (Backend)

| Resource | Specification | Price |
|----------|--------------|-------|
| Web Machine | shared-cpu-1x, 512MB | ~$3/month |
| Worker Machine | shared-cpu-2x, 1GB | ~$7/month |
| Postgres (Dev) | 256MB, 1GB storage | Free |
| Postgres (Prod) | 2GB, 10GB storage | ~$15/month |
| Upstash Redis | 10K commands/day | Free |
| Upstash Redis (Pro) | Unlimited | ~$10/month |
| Bandwidth | 100GB included | $0.02/GB after |

**Total (Development)**: ~$10-15/month
**Total (Production)**: ~$35-50/month

### Heroku (Frontend)

| Resource | Specification | Price |
|----------|--------------|-------|
| Eco Dyno | 512MB, sleeps after 30min | $5/month |
| Basic Dyno | 512MB, never sleeps | $7/month |
| Standard-1x | 512MB, horizontal scaling | $25/month |

**Recommended**: Basic Dyno at $7/month

### Total Monthly Cost

| Tier | Fly.io | Heroku | Total |
|------|--------|--------|-------|
| Development | $10 | $5 | **$15/month** |
| Production | $35 | $7 | **$42/month** |
| High Availability | $75+ | $25+ | **$100+/month** |

---

## Quick Reference

### Useful Commands

```bash
# === Fly.io ===
fly status                    # Check app status
fly logs                      # View logs
fly ssh console               # SSH into container
fly secrets set KEY=value     # Set secret
fly scale count worker=2      # Scale workers
fly deploy                    # Deploy changes
fly postgres connect          # Connect to database

# === Heroku ===
heroku ps                     # Check dyno status
heroku logs --tail            # View logs
heroku run bash               # Run one-off dyno
heroku config:set KEY=value   # Set config var
heroku restart                # Restart dynos
git push heroku main          # Deploy changes
```

### Environment Variables Summary

**Backend (Fly.io)**:
| Variable | Example |
|----------|---------|
| `SECRET_KEY` | Auto-generated Django secret |
| `DEBUG` | `False` |
| `ALLOWED_HOSTS` | `pyaglogen3d-api.fly.dev` |
| `DATABASE_URL` | Auto-set by `fly postgres attach` |
| `REDIS_URL` | From `fly redis create` output |
| `CORS_ORIGINS` | `https://your-frontend-domain.com` |

**Frontend (Heroku)**:
| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `https://pyaglogen3d-api.fly.dev/api/v1` |
| `NODE_ENV` | `production` |

---

## Support

- **Fly.io Documentation**: https://fly.io/docs/
- **Heroku Documentation**: https://devcenter.heroku.com/
- **Project Issues**: https://github.com/juanjoseexpositogonzalez/pyaglogen3D/issues
