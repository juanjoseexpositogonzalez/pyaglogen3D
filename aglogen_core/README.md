# aglogen_core

High-performance 3D agglomerate simulation and fractal analysis library written in Rust with Python bindings via PyO3.

## Features

### Simulation Algorithms
- **DLA (Diffusion-Limited Aggregation)**: Classic random-walk aggregation producing fractal structures (Df ~ 2.4-2.6)
- **CCA (Cluster-Cluster Aggregation)**: Hierarchical aggregation where clusters merge (Df ~ 1.8-2.0)
- **Ballistic Aggregation**: Straight-line particle trajectories producing dense structures (Df ~ 2.8-3.0)

### Fractal Analysis
- **Box-Counting**: Calculate fractal dimension from binary images

## Usage

```python
import aglogen_core

# Run DLA simulation
result = aglogen_core.run_dla(
    n_particles=1000,
    sticking_probability=1.0,
    seed=42
)

print(f"Fractal dimension: {result.fractal_dimension:.2f}")
print(f"Radius of gyration: {result.radius_of_gyration:.2f}")
print(f"Execution time: {result.execution_time_ms} ms")

# Access geometry
coords = result.coordinates  # numpy array (N, 3)
radii = result.radii  # numpy array (N,)
```

## Building

```bash
# Install maturin
pip install maturin

# Build and install in development mode
cd aglogen_core
maturin develop --release
```
