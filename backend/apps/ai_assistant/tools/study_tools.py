"""Parametric study tools for AI Assistant.

Provides tools for creating and managing parametric studies
that run multiple simulations with varying parameters.
"""

import itertools
import random
from typing import Any

from apps.projects.models import Project
from apps.simulations.models import (
    ParametricStudy,
    Simulation,
    SimulationAlgorithm,
    SimulationStatus,
)
from apps.simulations.tasks import run_simulation_task

from .base import ToolResult
from .decorators import tool


def _generate_parameter_combinations(
    parameter_grid: dict[str, list[Any]],
) -> list[dict[str, Any]]:
    """Generate all combinations from parameter grid.

    Args:
        parameter_grid: Dictionary mapping parameter names to lists of values.

    Returns:
        List of parameter dictionaries, one for each combination.
    """
    if not parameter_grid:
        return [{}]

    keys = list(parameter_grid.keys())
    values = [parameter_grid[k] for k in keys]

    combinations = []
    for combo in itertools.product(*values):
        combinations.append(dict(zip(keys, combo)))

    return combinations


@tool(
    name="create_parametric_study",
    description="Create a parametric study that runs multiple simulations varying specified parameters",
    category="study",
    requires_project=True,
    is_async=True,
)
def create_parametric_study_handler(
    name: str,
    algorithm: str,
    base_parameters: dict[str, Any],
    parameter_grid: dict[str, list[Any]],
    project_id: str | None = None,
    description: str = "",
    seeds_per_combination: int = 1,
    include_box_counting: bool = False,
    box_counting_params: dict[str, Any] | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Create and launch a parametric study.

    A parametric study runs multiple simulations varying specified parameters
    to understand how they affect the aggregate morphology.

    Args:
        name: Display name for the study.
        algorithm: Algorithm to use (dla, cca, ballistic, etc.).
        base_parameters: Fixed parameters for all simulations.
        parameter_grid: Parameters to vary {param_name: [value1, value2, ...]}.
        project_id: UUID of the project.
        description: Optional description of the study purpose.
        seeds_per_combination: Number of random seeds per parameter combination.
        include_box_counting: Whether to run box-counting analysis.
        box_counting_params: Box-counting configuration.
        user: The authenticated user.

    Returns:
        Dictionary with study_id, total_simulations, and status.

    Example:
        Create a study varying sticking probability:
        ```
        create_parametric_study(
            name="Sticking probability sweep",
            algorithm="dla",
            base_parameters={"n_particles": 1000, "lattice_size": 200},
            parameter_grid={"sticking_probability": [0.1, 0.3, 0.5, 0.7, 1.0]},
            seeds_per_combination=3,
        )
        ```
    """
    if project_id is None:
        raise ValueError("project_id is required")

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

    # Validate parameter grid
    if not parameter_grid:
        raise ValueError("parameter_grid must specify at least one parameter to vary")

    # Generate parameter combinations
    combinations = _generate_parameter_combinations(parameter_grid)
    total_simulations = len(combinations) * seeds_per_combination

    if total_simulations > 10000:
        raise ValueError(
            f"Study would create {total_simulations} simulations. "
            "Maximum is 10000. Reduce parameter grid or seeds_per_combination."
        )

    # Create the study
    study = ParametricStudy.objects.create(
        project=project,
        name=name,
        description=description,
        base_algorithm=algorithm.lower(),
        base_parameters=base_parameters,
        parameter_grid=parameter_grid,
        seeds_per_combination=seeds_per_combination,
        include_box_counting=include_box_counting,
        box_counting_params=box_counting_params,
        status=SimulationStatus.QUEUED,
    )

    # Create individual simulations
    simulations_created = []
    for combo in combinations:
        # Merge base parameters with varied parameters
        params = {**base_parameters, **combo}

        for seed_idx in range(seeds_per_combination):
            seed = random.randint(1, 2**31 - 1)

            sim = Simulation.objects.create(
                project=project,
                name=f"{name} - {combo} - seed {seed_idx + 1}",
                algorithm=algorithm.lower(),
                parameters=params,
                seed=seed,
                status=SimulationStatus.QUEUED,
            )
            simulations_created.append(sim)

            # Queue Celery task
            task = run_simulation_task.delay(str(sim.id))
            sim.task_id = task.id
            sim.save(update_fields=["task_id"])

    # Link simulations to study
    study.simulations.add(*simulations_created)
    study.status = SimulationStatus.RUNNING
    study.save(update_fields=["status"])

    return {
        "status": "running",
        "study_id": str(study.id),
        "study_name": name,
        "algorithm": algorithm.lower(),
        "total_simulations": total_simulations,
        "parameter_combinations": len(combinations),
        "seeds_per_combination": seeds_per_combination,
        "varied_parameters": list(parameter_grid.keys()),
        "message": f"Parametric study '{name}' created with {total_simulations} simulations",
    }


@tool(
    name="get_study_status",
    description="Get the current status and progress of a parametric study",
    category="study",
    requires_project=False,
)
def get_study_status_handler(
    study_id: str,
    user: Any = None,
) -> dict[str, Any]:
    """Get status and progress of a parametric study.

    Args:
        study_id: UUID of the parametric study.
        user: The authenticated user.

    Returns:
        Dictionary with study status, progress, and summary.
    """
    try:
        study = ParametricStudy.objects.get(id=study_id)
    except ParametricStudy.DoesNotExist:
        raise ValueError(f"Study '{study_id}' not found")

    # Get simulation statuses
    simulations = study.simulations.all()
    total = simulations.count()

    status_counts = {
        "queued": simulations.filter(status=SimulationStatus.QUEUED).count(),
        "running": simulations.filter(status=SimulationStatus.RUNNING).count(),
        "completed": simulations.filter(status=SimulationStatus.COMPLETED).count(),
        "failed": simulations.filter(status=SimulationStatus.FAILED).count(),
        "cancelled": simulations.filter(status=SimulationStatus.CANCELLED).count(),
    }

    completed = status_counts["completed"]
    failed = status_counts["failed"]
    progress_pct = round((completed + failed) / total * 100, 1) if total > 0 else 0

    # Determine overall status
    if completed + failed == total:
        overall_status = "completed" if failed == 0 else "completed_with_errors"
    elif status_counts["running"] > 0 or status_counts["queued"] > 0:
        overall_status = "running"
    else:
        overall_status = study.status

    return {
        "study_id": str(study.id),
        "study_name": study.name,
        "status": overall_status,
        "progress_percent": progress_pct,
        "total_simulations": total,
        "status_breakdown": status_counts,
        "algorithm": study.base_algorithm,
        "varied_parameters": list(study.parameter_grid.keys()),
        "created_at": study.created_at.isoformat(),
    }


@tool(
    name="get_study_results",
    description="Get aggregated results from a completed parametric study",
    category="study",
    requires_project=False,
)
def get_study_results_handler(
    study_id: str,
    include_individual: bool = False,
    user: Any = None,
) -> dict[str, Any]:
    """Get results from a completed parametric study.

    Args:
        study_id: UUID of the parametric study.
        include_individual: Whether to include individual simulation results.
        user: The authenticated user.

    Returns:
        Dictionary with aggregated metrics and optionally individual results.
    """
    try:
        study = ParametricStudy.objects.get(id=study_id)
    except ParametricStudy.DoesNotExist:
        raise ValueError(f"Study '{study_id}' not found")

    # Get completed simulations
    completed_sims = study.simulations.filter(
        status=SimulationStatus.COMPLETED
    ).exclude(metrics__isnull=True)

    if completed_sims.count() == 0:
        return {
            "study_id": str(study.id),
            "study_name": study.name,
            "status": "no_completed_simulations",
            "message": "No simulations have completed yet with metrics available",
        }

    # Aggregate metrics
    all_metrics = []
    parameter_values = {param: set() for param in study.parameter_grid.keys()}

    for sim in completed_sims:
        if sim.metrics:
            metrics_entry = {
                "simulation_id": str(sim.id),
                "parameters": sim.parameters,
                **sim.metrics,
            }
            all_metrics.append(metrics_entry)

            # Track parameter values used
            for param in study.parameter_grid.keys():
                if param in sim.parameters:
                    parameter_values[param].add(sim.parameters[param])

    # Calculate summary statistics
    df_values = [m.get("fractal_dimension") for m in all_metrics if m.get("fractal_dimension")]
    rg_values = [m.get("radius_of_gyration") for m in all_metrics if m.get("radius_of_gyration")]

    summary = {
        "completed_simulations": len(all_metrics),
        "total_simulations": study.simulations.count(),
    }

    if df_values:
        summary["fractal_dimension"] = {
            "min": round(min(df_values), 3),
            "max": round(max(df_values), 3),
            "mean": round(sum(df_values) / len(df_values), 3),
        }

    if rg_values:
        summary["radius_of_gyration"] = {
            "min": round(min(rg_values), 3),
            "max": round(max(rg_values), 3),
            "mean": round(sum(rg_values) / len(rg_values), 3),
        }

    result = {
        "study_id": str(study.id),
        "study_name": study.name,
        "algorithm": study.base_algorithm,
        "varied_parameters": list(study.parameter_grid.keys()),
        "parameter_values_used": {k: sorted(list(v)) for k, v in parameter_values.items()},
        "summary": summary,
    }

    if include_individual:
        result["individual_results"] = all_metrics

    return result


@tool(
    name="list_studies",
    description="List all parametric studies in a project",
    category="study",
    requires_project=True,
)
def list_studies_handler(
    project_id: str | None = None,
    status_filter: str | None = None,
    limit: int = 20,
    user: Any = None,
) -> dict[str, Any]:
    """List parametric studies in a project.

    Args:
        project_id: UUID of the project.
        status_filter: Optional filter by status (queued, running, completed, failed).
        limit: Maximum number of studies to return (default 20).
        user: The authenticated user.

    Returns:
        Dictionary with list of studies and count.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        raise ValueError(f"Project '{project_id}' not found")

    studies = ParametricStudy.objects.filter(project=project)

    if status_filter:
        valid_statuses = [choice[0] for choice in SimulationStatus.choices]
        if status_filter.lower() not in valid_statuses:
            raise ValueError(
                f"Invalid status_filter '{status_filter}'. Valid options: {valid_statuses}"
            )
        studies = studies.filter(status=status_filter.lower())

    studies = studies[:limit]

    study_list = []
    for study in studies:
        sim_count = study.simulations.count()
        completed_count = study.simulations.filter(status=SimulationStatus.COMPLETED).count()

        study_list.append({
            "study_id": str(study.id),
            "name": study.name,
            "algorithm": study.base_algorithm,
            "status": study.status,
            "total_simulations": sim_count,
            "completed_simulations": completed_count,
            "varied_parameters": list(study.parameter_grid.keys()),
            "created_at": study.created_at.isoformat(),
        })

    return {
        "project_id": str(project.id),
        "total_count": len(study_list),
        "studies": study_list,
    }


@tool(
    name="cancel_study",
    description="Cancel a running parametric study and its pending simulations",
    category="study",
    requires_project=False,
)
def cancel_study_handler(
    study_id: str,
    user: Any = None,
) -> dict[str, Any]:
    """Cancel a parametric study.

    Cancels all queued and running simulations in the study.

    Args:
        study_id: UUID of the parametric study.
        user: The authenticated user.

    Returns:
        Dictionary with cancellation status.
    """
    try:
        study = ParametricStudy.objects.get(id=study_id)
    except ParametricStudy.DoesNotExist:
        raise ValueError(f"Study '{study_id}' not found")

    if study.status in [SimulationStatus.COMPLETED, SimulationStatus.CANCELLED]:
        return {
            "study_id": str(study.id),
            "status": study.status,
            "message": f"Study is already {study.status}",
        }

    # Cancel pending simulations
    pending_sims = study.simulations.filter(
        status__in=[SimulationStatus.QUEUED, SimulationStatus.RUNNING]
    )
    cancelled_count = pending_sims.update(status=SimulationStatus.CANCELLED)

    # Update study status
    study.status = SimulationStatus.CANCELLED
    study.save(update_fields=["status"])

    return {
        "study_id": str(study.id),
        "status": "cancelled",
        "simulations_cancelled": cancelled_count,
        "message": f"Study cancelled. {cancelled_count} pending simulations cancelled.",
    }


# Export tool definitions
create_parametric_study_tool = create_parametric_study_handler
get_study_status_tool = get_study_status_handler
get_study_results_tool = get_study_results_handler
list_studies_tool = list_studies_handler
cancel_study_tool = cancel_study_handler
