"""Simulation tools for AI Assistant.

Provides tools for running particle agglomerate simulations
through the AI assistant interface.
"""

import random
from typing import Any

from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationAlgorithm, SimulationStatus
from apps.simulations.tasks import run_simulation_task

from .base import ToolResult
from .decorators import tool


def _create_simulation(
    project_id: str,
    algorithm: str,
    parameters: dict[str, Any],
    name: str | None = None,
) -> Simulation:
    """Create a simulation record and queue for execution.

    Args:
        project_id: UUID of the project.
        algorithm: Algorithm code (dla, cca, ballistic, etc.).
        parameters: Algorithm-specific parameters.
        name: Optional display name.

    Returns:
        The created Simulation instance.

    Raises:
        ValueError: If project not found or invalid algorithm.
    """
    # Validate project exists
    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        raise ValueError(f"Project '{project_id}' not found")

    # Validate algorithm
    valid_algorithms = [choice[0] for choice in SimulationAlgorithm.choices]
    if algorithm.lower() not in valid_algorithms:
        raise ValueError(
            f"Invalid algorithm '{algorithm}'. Valid options: {valid_algorithms}"
        )

    # Generate seed if not provided
    seed = parameters.pop("seed", None) or random.randint(1, 2**31 - 1)

    # Create simulation record
    simulation = Simulation.objects.create(
        project=project,
        name=name or "",
        algorithm=algorithm.lower(),
        parameters=parameters,
        seed=seed,
        status=SimulationStatus.QUEUED,
    )

    # Queue Celery task
    task = run_simulation_task.delay(str(simulation.id))
    simulation.task_id = task.id
    simulation.save(update_fields=["task_id"])

    return simulation


@tool(
    name="run_simulation",
    description="Run a particle agglomerate simulation with the specified algorithm and parameters",
    category="simulation",
    requires_project=True,
    is_async=True,
)
def run_simulation_handler(
    algorithm: str,
    n_particles: int,
    project_id: str | None = None,
    name: str | None = None,
    sticking_probability: float = 1.0,
    particle_radius: float = 1.0,
    seed: int | None = None,
    user: Any = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Run a simulation with any supported algorithm.

    Args:
        algorithm: Algorithm to use (dla, cca, ballistic, ballistic_cc, tunable, tunable_cc, limiting).
        n_particles: Number of particles to simulate (10-100000).
        project_id: UUID of the project to add simulation to.
        name: Optional display name for the simulation.
        sticking_probability: Probability of particle sticking (0.0-1.0).
        particle_radius: Primary particle radius.
        seed: Random seed for reproducibility.
        user: The authenticated user.
        **kwargs: Additional algorithm-specific parameters.

    Returns:
        Dictionary with simulation_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    if n_particles < 10 or n_particles > 100000:
        raise ValueError("n_particles must be between 10 and 100000")

    if sticking_probability < 0.0 or sticking_probability > 1.0:
        raise ValueError("sticking_probability must be between 0.0 and 1.0")

    parameters = {
        "n_particles": n_particles,
        "sticking_probability": sticking_probability,
        "particle_radius": particle_radius,
        **kwargs,
    }

    if seed is not None:
        parameters["seed"] = seed

    simulation = _create_simulation(
        project_id=project_id,
        algorithm=algorithm,
        parameters=parameters,
        name=name,
    )

    return {
        "status": "queued",
        "simulation_id": str(simulation.id),
        "task_id": simulation.task_id,
        "algorithm": simulation.algorithm,
        "n_particles": n_particles,
        "message": f"{simulation.get_algorithm_display()} simulation queued with {n_particles} particles",
    }


@tool(
    name="run_dla_simulation",
    description="Run a Diffusion-Limited Aggregation (DLA) simulation - particles perform random walks until they stick to the growing cluster",
    category="simulation",
    requires_project=True,
    is_async=True,
)
def run_dla_simulation_handler(
    n_particles: int,
    project_id: str | None = None,
    name: str | None = None,
    sticking_probability: float = 1.0,
    particle_radius: float = 1.0,
    lattice_size: int = 200,
    seed: int | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Run a DLA (Diffusion-Limited Aggregation) simulation.

    DLA produces fractal structures with Df ~ 2.5 in 3D.
    Particles perform random walks until they contact and stick to the cluster.

    Args:
        n_particles: Number of particles to simulate (10-100000).
        project_id: UUID of the project.
        name: Optional display name.
        sticking_probability: Probability of sticking on contact (0.0-1.0).
        particle_radius: Primary particle radius.
        lattice_size: Size of the simulation lattice.
        seed: Random seed for reproducibility.
        user: The authenticated user.

    Returns:
        Dictionary with simulation_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    parameters = {
        "n_particles": n_particles,
        "sticking_probability": sticking_probability,
        "particle_radius": particle_radius,
        "lattice_size": lattice_size,
    }

    if seed is not None:
        parameters["seed"] = seed

    simulation = _create_simulation(
        project_id=project_id,
        algorithm="dla",
        parameters=parameters,
        name=name,
    )

    return {
        "status": "queued",
        "simulation_id": str(simulation.id),
        "task_id": simulation.task_id,
        "algorithm": "dla",
        "n_particles": n_particles,
        "message": f"DLA simulation queued with {n_particles} particles",
    }


@tool(
    name="run_cca_simulation",
    description="Run a Cluster-Cluster Aggregation (CCA) simulation - clusters diffuse and merge to form larger aggregates",
    category="simulation",
    requires_project=True,
    is_async=True,
)
def run_cca_simulation_handler(
    n_particles: int,
    project_id: str | None = None,
    name: str | None = None,
    sticking_probability: float = 1.0,
    particle_radius: float = 1.0,
    box_size: float = 100.0,
    single_agglomerate: bool = True,
    seed: int | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Run a CCA (Cluster-Cluster Aggregation) simulation.

    CCA produces more open, fractal structures with Df ~ 1.8 in 3D.
    Multiple clusters diffuse and merge upon contact.

    Args:
        n_particles: Number of particles to simulate (10-100000).
        project_id: UUID of the project.
        name: Optional display name.
        sticking_probability: Probability of sticking on contact (0.0-1.0).
        particle_radius: Primary particle radius.
        box_size: Size of the simulation box.
        single_agglomerate: Whether to continue until one cluster remains.
        seed: Random seed for reproducibility.
        user: The authenticated user.

    Returns:
        Dictionary with simulation_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    parameters = {
        "n_particles": n_particles,
        "sticking_probability": sticking_probability,
        "particle_radius": particle_radius,
        "box_size": box_size,
        "single_agglomerate": single_agglomerate,
    }

    if seed is not None:
        parameters["seed"] = seed

    simulation = _create_simulation(
        project_id=project_id,
        algorithm="cca",
        parameters=parameters,
        name=name,
    )

    return {
        "status": "queued",
        "simulation_id": str(simulation.id),
        "task_id": simulation.task_id,
        "algorithm": "cca",
        "n_particles": n_particles,
        "message": f"CCA simulation queued with {n_particles} particles",
    }


@tool(
    name="run_ballistic_simulation",
    description="Run a Ballistic Particle-Cluster Aggregation simulation - particles travel in straight lines until hitting the cluster",
    category="simulation",
    requires_project=True,
    is_async=True,
)
def run_ballistic_simulation_handler(
    n_particles: int,
    project_id: str | None = None,
    name: str | None = None,
    sticking_probability: float = 1.0,
    particle_radius: float = 1.0,
    seed: int | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Run a Ballistic Particle-Cluster Aggregation simulation.

    Ballistic aggregation produces denser structures than DLA (Df ~ 3.0).
    Particles travel in straight lines from random directions.

    Args:
        n_particles: Number of particles to simulate (10-100000).
        project_id: UUID of the project.
        name: Optional display name.
        sticking_probability: Probability of sticking on contact (0.0-1.0).
        particle_radius: Primary particle radius.
        seed: Random seed for reproducibility.
        user: The authenticated user.

    Returns:
        Dictionary with simulation_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    parameters = {
        "n_particles": n_particles,
        "sticking_probability": sticking_probability,
        "particle_radius": particle_radius,
    }

    if seed is not None:
        parameters["seed"] = seed

    simulation = _create_simulation(
        project_id=project_id,
        algorithm="ballistic",
        parameters=parameters,
        name=name,
    )

    return {
        "status": "queued",
        "simulation_id": str(simulation.id),
        "task_id": simulation.task_id,
        "algorithm": "ballistic",
        "n_particles": n_particles,
        "message": f"Ballistic simulation queued with {n_particles} particles",
    }


@tool(
    name="run_ballistic_cc_simulation",
    description="Run a Ballistic Cluster-Cluster Aggregation simulation - clusters travel ballistically and merge",
    category="simulation",
    requires_project=True,
    is_async=True,
)
def run_ballistic_cc_simulation_handler(
    n_particles: int,
    project_id: str | None = None,
    name: str | None = None,
    sticking_probability: float = 1.0,
    particle_radius: float = 1.0,
    seed: int | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Run a Ballistic Cluster-Cluster Aggregation simulation.

    Combines ballistic motion with cluster-cluster aggregation.
    Produces structures with intermediate fractal dimensions.

    Args:
        n_particles: Number of particles to simulate (10-100000).
        project_id: UUID of the project.
        name: Optional display name.
        sticking_probability: Probability of sticking on contact (0.0-1.0).
        particle_radius: Primary particle radius.
        seed: Random seed for reproducibility.
        user: The authenticated user.

    Returns:
        Dictionary with simulation_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    parameters = {
        "n_particles": n_particles,
        "sticking_probability": sticking_probability,
        "particle_radius": particle_radius,
    }

    if seed is not None:
        parameters["seed"] = seed

    simulation = _create_simulation(
        project_id=project_id,
        algorithm="ballistic_cc",
        parameters=parameters,
        name=name,
    )

    return {
        "status": "queued",
        "simulation_id": str(simulation.id),
        "task_id": simulation.task_id,
        "algorithm": "ballistic_cc",
        "n_particles": n_particles,
        "message": f"Ballistic CC simulation queued with {n_particles} particles",
    }


@tool(
    name="run_tunable_simulation",
    description="Run a Tunable simulation with controllable fractal dimension - specify target Df and kf values",
    category="simulation",
    requires_project=True,
    is_async=True,
)
def run_tunable_simulation_handler(
    n_particles: int,
    target_df: float,
    project_id: str | None = None,
    name: str | None = None,
    target_kf: float = 1.3,
    particle_radius: float = 1.0,
    seed: int | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Run a Tunable simulation with controllable fractal dimension.

    Allows specifying target fractal dimension (Df) and prefactor (kf).
    Useful for generating aggregates with specific morphological properties.

    Args:
        n_particles: Number of particles to simulate (10-100000).
        target_df: Target fractal dimension (typically 1.0-3.0).
        project_id: UUID of the project.
        name: Optional display name.
        target_kf: Target prefactor (typically 1.0-2.0).
        particle_radius: Primary particle radius.
        seed: Random seed for reproducibility.
        user: The authenticated user.

    Returns:
        Dictionary with simulation_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    if target_df < 1.0 or target_df > 3.0:
        raise ValueError("target_df must be between 1.0 and 3.0")

    parameters = {
        "n_particles": n_particles,
        "target_df": target_df,
        "target_kf": target_kf,
        "particle_radius": particle_radius,
    }

    if seed is not None:
        parameters["seed"] = seed

    simulation = _create_simulation(
        project_id=project_id,
        algorithm="tunable",
        parameters=parameters,
        name=name,
    )

    return {
        "status": "queued",
        "simulation_id": str(simulation.id),
        "task_id": simulation.task_id,
        "algorithm": "tunable",
        "n_particles": n_particles,
        "target_df": target_df,
        "message": f"Tunable simulation queued with {n_particles} particles, target Df={target_df}",
    }


@tool(
    name="run_limiting_case",
    description="Generate a deterministic limiting case geometry (chain, plane, or sphere) with known fractal dimension",
    category="simulation",
    requires_project=True,
    is_async=True,
)
def run_limiting_case_handler(
    geometry_type: str,
    n_particles: int,
    project_id: str | None = None,
    name: str | None = None,
    configuration_type: str | None = None,
    packing: str = "HC",
    layers: int | None = None,
    particle_radius: float = 1.0,
    sintering_coeff: float = 1.0,
    user: Any = None,
) -> dict[str, Any]:
    """Generate a deterministic limiting case geometry.

    Creates geometries with known theoretical fractal dimensions:
    - chain (Df=1): lineal, cruz2d, asterisco, cruz3d
    - plane (Df=2): plano, dobleplano, tripleplano
    - sphere (Df=3): cuboctaedro

    Args:
        geometry_type: Type of geometry (chain, plane, sphere).
        n_particles: Target number of particles.
        project_id: UUID of the project.
        name: Optional display name.
        configuration_type: Specific configuration within geometry type.
        packing: Packing type (HC=Hexagonal Compact, CS=Cubic Simple, CCC=FCC).
        layers: Number of layers (alternative to n_particles).
        particle_radius: Primary particle radius.
        sintering_coeff: Sintering coefficient (1.0=touching, <1.0=overlapping).
        user: The authenticated user.

    Returns:
        Dictionary with simulation_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    valid_geometry_types = ["chain", "plane", "sphere"]
    if geometry_type.lower() not in valid_geometry_types:
        raise ValueError(
            f"Invalid geometry_type '{geometry_type}'. Valid options: {valid_geometry_types}"
        )

    parameters = {
        "n_particles": n_particles,
        "geometry_type": geometry_type.lower(),
        "packing": packing.upper(),
        "particle_radius": particle_radius,
        "sintering_coeff": sintering_coeff,
    }

    if configuration_type:
        parameters["configuration_type"] = configuration_type

    if layers is not None:
        parameters["layers"] = layers

    simulation = _create_simulation(
        project_id=project_id,
        algorithm="limiting",
        parameters=parameters,
        name=name,
    )

    expected_df = {"chain": 1.0, "plane": 2.0, "sphere": 3.0}[geometry_type.lower()]

    return {
        "status": "queued",
        "simulation_id": str(simulation.id),
        "task_id": simulation.task_id,
        "algorithm": "limiting",
        "geometry_type": geometry_type,
        "expected_df": expected_df,
        "message": f"Limiting case ({geometry_type}, Df={expected_df}) queued with ~{n_particles} particles",
    }


# Export tool definitions
run_simulation_tool = run_simulation_handler
run_dla_simulation_tool = run_dla_simulation_handler
run_cca_simulation_tool = run_cca_simulation_handler
run_ballistic_simulation_tool = run_ballistic_simulation_handler
run_ballistic_cc_simulation_tool = run_ballistic_cc_simulation_handler
run_tunable_simulation_tool = run_tunable_simulation_handler
run_limiting_case_tool = run_limiting_case_handler
