"""Simulation Celery tasks."""
import io
import logging
from uuid import UUID

import numpy as np
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=1)
def run_simulation_task(self, simulation_id: str) -> dict:
    """Execute simulation using Rust engine."""
    from .models import Simulation, SimulationStatus

    simulation = Simulation.objects.get(id=UUID(simulation_id))

    # Update status to running
    simulation.status = SimulationStatus.RUNNING
    simulation.started_at = timezone.now()
    simulation.save(update_fields=["status", "started_at"])

    try:
        import aglogen_core

        algorithm = simulation.algorithm
        params = simulation.parameters
        seed = simulation.seed

        logger.info(
            f"Running {algorithm} simulation {simulation_id} "
            f"with {params.get('n_particles', 1000)} particles"
        )

        # Run the appropriate algorithm
        if algorithm == "dla":
            result = aglogen_core.run_dla(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 1.0),
                lattice_size=params.get("lattice_size", 200),
                seed_radius=params.get("seed_radius", 1.0),
                seed=seed,
            )
        elif algorithm == "cca":
            result = aglogen_core.run_cca(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 1.0),
                particle_radius=params.get("particle_radius", 1.0),
                box_size=params.get("box_size", 100.0),
                seed=seed,
            )
        elif algorithm == "ballistic":
            result = aglogen_core.run_ballistic(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 1.0),
                particle_radius=params.get("particle_radius", 1.0),
                seed=seed,
            )
        elif algorithm == "tunable":
            # Tunable uses DLA with varying sticking probability
            result = aglogen_core.run_dla(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 0.5),
                lattice_size=params.get("lattice_size", 200),
                seed_radius=params.get("seed_radius", 1.0),
                seed=seed,
            )
        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")

        # Convert coordinates to bytes (N x 4: x, y, z, radius)
        geometry_array = np.column_stack([
            result.coordinates,
            result.radii.reshape(-1, 1)
        ])
        buffer = io.BytesIO()
        np.save(buffer, geometry_array)
        simulation.geometry = buffer.getvalue()

        # Store metrics
        simulation.metrics = {
            "fractal_dimension": float(result.fractal_dimension),
            "fractal_dimension_std": float(result.fractal_dimension_std),
            "prefactor": float(result.prefactor),
            "radius_of_gyration": float(result.radius_of_gyration),
            "porosity": float(result.porosity),
            "coordination": {
                "mean": float(result.coordination_mean),
                "std": float(result.coordination_std),
            },
            "rg_evolution": result.rg_evolution.tolist(),
        }
        simulation.execution_time_ms = result.execution_time_ms
        simulation.engine_version = aglogen_core.version()

        simulation.status = SimulationStatus.COMPLETED
        simulation.completed_at = timezone.now()
        simulation.save()

        logger.info(
            f"Simulation {simulation_id} completed: "
            f"Df={result.fractal_dimension:.3f}, Rg={result.radius_of_gyration:.2f}, "
            f"time={result.execution_time_ms}ms"
        )

        return {
            "status": "completed",
            "simulation_id": simulation_id,
            "fractal_dimension": simulation.metrics["fractal_dimension"],
            "execution_time_ms": simulation.execution_time_ms,
        }

    except ImportError as e:
        logger.error(f"aglogen_core not installed: {e}")
        simulation.status = SimulationStatus.FAILED
        simulation.error_message = "Rust engine not installed. Run: cd aglogen_core && maturin develop --release"
        simulation.completed_at = timezone.now()
        simulation.save()

        return {
            "status": "failed",
            "simulation_id": simulation_id,
            "error": str(simulation.error_message),
        }

    except Exception as e:
        logger.exception(f"Simulation {simulation_id} failed: {e}")
        simulation.status = SimulationStatus.FAILED
        simulation.error_message = str(e)
        simulation.completed_at = timezone.now()
        simulation.save()

        return {
            "status": "failed",
            "simulation_id": simulation_id,
            "error": str(e),
        }
