# pyAgloGen3D

3D Agglomerate Simulation and Fractal Analysis Platform

A modern migration of AgloGen3D (Matlab) to Python + Rust + Next.js with full scientific reproducibility.

## Features

### 3D Particle Aggregation Simulation
- Diffusion-Limited Aggregation (DLA)
- Cluster-Cluster Aggregation (CCA)
- Ballistic Aggregation
- Tunable fractal dimension (target Df and Kf)
- **Sintering support** - fixed, uniform, or normal distribution coefficients

### Batch Simulations (Parametric Studies)
- Parameter grid exploration with automatic combination generation
- **Limiting cases** - boundary values and theoretical extremes (Df=1.0 chains to Df=3.0 compact)
- **Sintering distributions** - fixed coefficient, uniform range, or normal distribution
- **Box-counting analysis** - optional fractal dimension estimation per simulation
- Auto-generated simulation names with timestamps
- CSV export with all metrics and parameters

### 2D Fractal Analysis
- Box-Counting dimension
- Sandbox Method
- Correlation Dimension
- Lacunarity
- Multifractal Dq Spectrum

### FRAKTAL Analysis (3D to 2D)
- Granulated 2012 model
- Voxel 2018 model
- Auto-calibration support
- Simulation projection analysis

### Interactive Visualization
- 3D WebGL viewer (React Three Fiber)
- Scientific charts (Plotly)
- Export to STL, OBJ, CSV

### Full Reproducibility
- All parameters persisted in PostgreSQL
- Deterministic RNG with seed storage
- Complete geometry storage

## Architecture

```
pyaglogen3D/
├── backend/           # Django REST API + Celery tasks
├── aglogen_core/      # Rust simulation engine (PyO3)
├── frontend/          # Next.js web interface
└── docs/              # Documentation (SDD, API specs)
```

## Quick Start

### Prerequisites

- Python 3.11+
- Rust 1.70+
- Node.js 18+
- Docker & Docker Compose

### Development Setup

```bash
# Clone and setup
git clone https://github.com/juanjoseexpositogonzalez/pyaglogen3D.git
cd pyaglogen3D

# Start services
docker compose up -d db redis

# Backend
cd backend
python -m venv ../.venv
source ../.venv/bin/activate
pip install -e ".[dev]"
python manage.py migrate
python manage.py runserver

# Rust engine (in another terminal)
cd aglogen_core
maturin develop

# Celery worker (in another terminal)
cd backend
celery -A config worker -l info

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

### Run with Docker

```bash
docker compose up --build
```

## API Endpoints

### Projects
- `GET/POST /api/v1/projects/` - List/create projects
- `GET/PUT/DELETE /api/v1/projects/{id}/` - Project details

### Simulations
- `GET/POST /api/v1/projects/{id}/simulations/` - List/create simulations
- `GET /api/v1/simulations/{id}/` - Simulation details
- `GET /api/v1/simulations/{id}/geometry/` - Download geometry data

### Parametric Studies (Batch Simulations)
- `GET/POST /api/v1/projects/{id}/parametric-studies/` - List/create studies
- `GET /api/v1/parametric-studies/{id}/` - Study details
- `GET /api/v1/parametric-studies/{id}/export_csv/` - Export results to CSV

### Fractal Analysis
- `GET/POST /api/v1/projects/{id}/image-analyses/` - Image analysis
- `GET/POST /api/v1/projects/{id}/fraktal-analyses/` - FRAKTAL analysis

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/pyaglogen3d

# Redis (Celery broker)
REDIS_URL=redis://localhost:6379/0

# Django
SECRET_KEY=your-secret-key
DEBUG=True
```

## Documentation

See `docs/` for:
- `SDD.md` - Software Design Document
- `API_SCHEMAS.md` - REST API specification
- `RUST_INTERFACES.md` - Rust module documentation
- `DATABASE_SCHEMA.md` - PostgreSQL schema
- `FRONTEND_COMPONENTS.md` - React components

See also:
- `DEPLOY.md` - Deployment guide for production

## Testing

```bash
cd backend
source ../.venv/bin/activate
pytest tests/ -v
```

## License

MIT
