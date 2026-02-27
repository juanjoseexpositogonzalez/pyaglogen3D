"""Utility tools for AI Assistant.

Provides basic utility tools that help the AI assistant understand
the system state and available capabilities.
"""

from typing import Any

from celery.result import AsyncResult
from django.contrib.auth import get_user_model

from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationAlgorithm, SimulationStatus

from .base import ToolResult
from .decorators import tool

User = get_user_model()


@tool(
    name="list_algorithms",
    description="List all available simulation algorithms with their descriptions",
    category="utility",
)
def list_algorithms_handler(user: Any) -> dict[str, Any]:
    """List all available simulation algorithms.

    Args:
        user: The authenticated user.

    Returns:
        Dictionary containing available algorithms.
    """
    algorithms = []
    for algorithm in SimulationAlgorithm.choices:
        algorithms.append({
            "code": algorithm[0],
            "name": algorithm[1],
        })

    return {
        "algorithms": algorithms,
        "count": len(algorithms),
    }


@tool(
    name="get_project_info",
    description="Get detailed information about a project including simulation and analysis counts",
    category="utility",
    requires_project=False,
)
def get_project_info_handler(
    project_id: str | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Get information about a specific project.

    Args:
        project_id: The UUID of the project to retrieve.
        user: The authenticated user.

    Returns:
        Dictionary containing project details.

    Raises:
        ValueError: If project is not found.
    """
    if project_id is None:
        # List all projects
        projects = Project.objects.all().order_by("-updated_at")[:10]
        return {
            "projects": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "description": p.description[:100] if p.description else "",
                    "simulation_count": p.simulation_count,
                    "analysis_count": p.analysis_count,
                    "updated_at": p.updated_at.isoformat(),
                }
                for p in projects
            ],
            "count": len(projects),
            "message": "Use project_id parameter to get detailed information about a specific project.",
        }

    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        raise ValueError(f"Project '{project_id}' not found")

    # Get recent simulations
    recent_simulations = project.simulations.order_by("-created_at")[:5]

    # Get status counts
    status_counts = {}
    for status in SimulationStatus.choices:
        count = project.simulations.filter(status=status[0]).count()
        if count > 0:
            status_counts[status[0]] = count

    return {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
        "simulation_count": project.simulation_count,
        "analysis_count": project.analysis_count,
        "simulation_status_counts": status_counts,
        "recent_simulations": [
            {
                "id": str(sim.id),
                "name": sim.name or f"{sim.algorithm} simulation",
                "algorithm": sim.algorithm,
                "status": sim.status,
                "created_at": sim.created_at.isoformat(),
            }
            for sim in recent_simulations
        ],
    }


@tool(
    name="check_task_status",
    description="Check the status of an asynchronous task (e.g., a running simulation)",
    category="utility",
)
def check_task_status_handler(
    task_id: str,
    user: Any = None,
) -> dict[str, Any]:
    """Check the status of a Celery task.

    Args:
        task_id: The Celery task ID to check.
        user: The authenticated user.

    Returns:
        Dictionary containing task status information.
    """
    result = AsyncResult(task_id)

    response: dict[str, Any] = {
        "task_id": task_id,
        "status": result.status,
    }

    if result.ready():
        if result.successful():
            response["result"] = result.result
        elif result.failed():
            response["error"] = str(result.result)
    elif result.status == "PROGRESS":
        # Custom progress info
        response["progress"] = result.info

    return response


@tool(
    name="list_simulations",
    description="List simulations with optional filtering by project, algorithm, or status",
    category="utility",
)
def list_simulations_handler(
    project_id: str | None = None,
    algorithm: str | None = None,
    status: str | None = None,
    limit: int = 20,
    user: Any = None,
) -> dict[str, Any]:
    """List simulations with optional filters.

    Args:
        project_id: Filter by project UUID.
        algorithm: Filter by algorithm code (e.g., "dla", "cca").
        status: Filter by status (e.g., "completed", "running").
        limit: Maximum number of results (default 20, max 100).
        user: The authenticated user.

    Returns:
        Dictionary containing simulation list.
    """
    # Apply limit bounds
    limit = min(max(1, limit), 100)

    # Build query
    queryset = Simulation.objects.all()

    if project_id:
        queryset = queryset.filter(project_id=project_id)

    if algorithm:
        queryset = queryset.filter(algorithm=algorithm.lower())

    if status:
        queryset = queryset.filter(status=status.lower())

    queryset = queryset.order_by("-created_at")[:limit]

    simulations = []
    for sim in queryset:
        sim_data = {
            "id": str(sim.id),
            "name": sim.name or f"{sim.algorithm} simulation",
            "algorithm": sim.algorithm,
            "status": sim.status,
            "project_id": str(sim.project_id),
            "created_at": sim.created_at.isoformat(),
        }

        # Add metrics if completed
        if sim.status == SimulationStatus.COMPLETED and sim.metrics:
            sim_data["metrics"] = {
                k: sim.metrics[k]
                for k in ["n_particles", "df", "kf", "rg"]
                if k in sim.metrics
            }

        simulations.append(sim_data)

    return {
        "simulations": simulations,
        "count": len(simulations),
        "filters_applied": {
            "project_id": project_id,
            "algorithm": algorithm,
            "status": status,
            "limit": limit,
        },
    }


@tool(
    name="get_simulation_details",
    description="Get detailed information about a specific simulation including metrics and parameters",
    category="utility",
)
def get_simulation_details_handler(
    simulation_id: str,
    user: Any = None,
) -> dict[str, Any]:
    """Get detailed information about a simulation.

    Args:
        simulation_id: The UUID of the simulation.
        user: The authenticated user.

    Returns:
        Dictionary containing simulation details.

    Raises:
        ValueError: If simulation is not found.
    """
    try:
        simulation = Simulation.objects.get(id=simulation_id)
    except Simulation.DoesNotExist:
        raise ValueError(f"Simulation '{simulation_id}' not found")

    result: dict[str, Any] = {
        "id": str(simulation.id),
        "name": simulation.name or f"{simulation.algorithm} simulation",
        "project_id": str(simulation.project_id),
        "project_name": simulation.project.name,
        "algorithm": simulation.algorithm,
        "algorithm_name": simulation.get_algorithm_display(),
        "status": simulation.status,
        "status_name": simulation.get_status_display(),
        "parameters": simulation.parameters,
        "seed": simulation.seed,
        "created_at": simulation.created_at.isoformat(),
    }

    # Add timing info if available
    if simulation.started_at:
        result["started_at"] = simulation.started_at.isoformat()
    if simulation.completed_at:
        result["completed_at"] = simulation.completed_at.isoformat()
    if simulation.execution_time_ms:
        result["execution_time_ms"] = simulation.execution_time_ms

    # Add metrics if completed
    if simulation.status == SimulationStatus.COMPLETED and simulation.metrics:
        result["metrics"] = simulation.metrics

    # Add error if failed
    if simulation.status == SimulationStatus.FAILED and simulation.error_message:
        result["error_message"] = simulation.error_message

    # Add task info if running
    if simulation.task_id:
        result["task_id"] = simulation.task_id

    return result


# Tool definitions exported for registration
list_algorithms_tool = list_algorithms_handler
get_project_info_tool = get_project_info_handler
check_task_status_tool = check_task_status_handler
list_simulations_tool = list_simulations_handler
get_simulation_details_tool = get_simulation_details_handler
