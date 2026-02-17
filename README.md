# pyAgloGen3D

3D Agglomerate Simulation and Fractal Analysis Platform

A modern migration of AgloGen3D (Matlab) to Python + Rust + Next.js with full scientific reproducibility.

## Features

- **3D Particle Aggregation Simulation**
  - Diffusion-Limited Aggregation (DLA)
  - Cluster-Cluster Aggregation (CCA)
  - Ballistic Aggregation
  - Tunable fractal dimension

- **2D Fractal Analysis**
  - Box-Counting
  - Sandbox Method
  - Correlation Dimension
  - Lacunarity
  - Multifractal Dq Spectrum

- **Interactive Visualization**
  - 3D WebGL viewer (React Three Fiber)
  - Scientific charts (Plotly)
  - Export to STL, OBJ, CSV

- **Full Reproducibility**
  - All parameters persisted in PostgreSQL
  - Deterministic RNG with seed storage
  - Complete geometry storage

## Architecture

```
pyaglogen3D/
├── backend/           # Django REST API
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
cd ~/code/pyaglogen3D

# Start services
docker compose up -d db redis

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python manage.py migrate
python manage.py runserver

# Rust engine (in another terminal)
cd aglogen_core
maturin develop

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

### Run with Docker

```bash
docker compose up --build
```

## API

- Backend API: http://localhost:8000/api/v1/
- Frontend: http://localhost:3000/

## Documentation

See `docs/` for:
- `SDD.md` - Software Design Document
- `API_SCHEMAS.md` - REST API specification
- `RUST_INTERFACES.md` - Rust module documentation
- `DATABASE_SCHEMA.md` - PostgreSQL schema
- `FRONTEND_COMPONENTS.md` - React components

## License

MIT
