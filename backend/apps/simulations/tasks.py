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
        # Import Rust module (will be available after building aglogen_core)
        # import aglogen_core
        #
        # if simulation.algorithm == "dla":
        #     result = aglogen_core.run_dla(
        #         n_particles=simulation.parameters.get("n_particles", 1000),
        #         sticking_probability=simulation.parameters.get("sticking_probability", 1.0),
        #         lattice_size=simulation.parameters.get("lattice_size", 200),
        #         seed=simulation.seed,
        #     )
        #
        #     # Convert coordinates to bytes
        #     geometry_array = np.column_stack([
        #         result.coordinates,
        #         result.radii.reshape(-1, 1)
        #     ])
        #     buffer = io.BytesIO()
        #     np.save(buffer, geometry_array)
        #     simulation.geometry = buffer.getvalue()
        #
        #     simulation.metrics = {
        #         "fractal_dimension": result.fractal_dimension,
        #         "prefactor": result.prefactor,
        #         "radius_of_gyration": result.radius_of_gyration,
        #         "porosity": result.porosity,
        #         "coordination": {
        #             "mean": result.coordination_mean,
        #             "std": result.coordination_std,
        #         },
        #     }
        #     simulation.execution_time_ms = result.execution_time_ms
        #     simulation.engine_version = aglogen_core.version()

        # PLACEHOLDER: Generate dummy data until Rust module is ready
        n_particles = simulation.parameters.get("n_particles", 100)
        logger.info(f"Running simulation {simulation_id} with {n_particles} particles")

        # Generate dummy spherical cluster
        np.random.seed(simulation.seed)
        theta = np.random.uniform(0, 2 * np.pi, n_particles)
        phi = np.random.uniform(0, np.pi, n_particles)
        r = np.random.uniform(0, 50, n_particles) ** (1 / 3) * 50  # Cube root for uniform volume

        coordinates = np.column_stack([
            r * np.sin(phi) * np.cos(theta),
            r * np.sin(phi) * np.sin(theta),
            r * np.cos(phi),
            np.ones(n_particles) * 1.0,  # radius
        ])

        buffer = io.BytesIO()
        np.save(buffer, coordinates)
        simulation.geometry = buffer.getvalue()

        # Dummy metrics
        simulation.metrics = {
            "fractal_dimension": 1.78 + np.random.uniform(-0.1, 0.1),
            "fractal_dimension_std": 0.02,
            "prefactor": 1.23 + np.random.uniform(-0.1, 0.1),
            "radius_of_gyration": 45.6 + np.random.uniform(-5, 5),
            "porosity": 0.82,
            "coordination": {
                "mean": 2.4,
                "std": 1.1,
                "histogram": [0, 250, 420, 240, 70, 16, 4],
            },
        }
        simulation.execution_time_ms = 1000 + int(np.random.uniform(0, 2000))
        simulation.engine_version = "0.1.0-placeholder"

        simulation.status = SimulationStatus.COMPLETED
        simulation.completed_at = timezone.now()
        simulation.save()

        logger.info(f"Simulation {simulation_id} completed successfully")

        return {
            "status": "completed",
            "simulation_id": simulation_id,
            "fractal_dimension": simulation.metrics["fractal_dimension"],
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
