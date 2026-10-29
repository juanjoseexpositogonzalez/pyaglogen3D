# pyAgloGen3D Backend

Django REST API backend for 3D agglomerate simulation and fractal analysis.

## Features

- Project management for research workflows
- 3D particle simulation (DLA, CCA, Ballistic, Tunable)
- 2D image fractal analysis (Box-counting, Sandbox, Correlation, Lacunarity, Multifractal)
- Celery task queue for asynchronous processing

## Development

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Run migrations
python manage.py migrate

# Run development server
python manage.py runserver
```
