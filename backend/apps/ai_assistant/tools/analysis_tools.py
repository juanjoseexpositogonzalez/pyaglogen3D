"""Analysis tools for AI Assistant.

Provides tools for running fractal analysis, box-counting,
comparing simulations, and analyzing parametric studies.
"""

import io
from typing import Any

import numpy as np
from apps.fractal_analysis.models import (
    AnalysisStatus,
    FraktalAnalysis,
    ImageAnalysis,
    SourceType,
)
from apps.fractal_analysis.tasks import run_fraktal_analysis_task
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation, SimulationStatus

from .base import ToolResult
from .decorators import tool


@tool(
    name="run_box_counting",
    description="Run 3D box-counting fractal analysis on a completed simulation",
    category="analysis",
    requires_project=False,
    is_async=True,
)
def run_box_counting_handler(
    simulation_id: str,
    points_per_sphere: int = 100,
    precision: int = 18,
    user: Any = None,
) -> dict[str, Any]:
    """Run box-counting analysis on a simulation.

    Box-counting computes the fractal dimension by counting how many
    boxes of varying sizes are needed to cover the agglomerate.

    Args:
        simulation_id: UUID of the simulation to analyze.
        points_per_sphere: Number of points to sample per sphere (default 100).
        precision: Number of box sizes to use (default 18).
        user: The authenticated user.

    Returns:
        Dictionary with dimension, r_squared, and confidence interval.

    Example:
        ```
        run_box_counting(
            simulation_id="550e8400-e29b-41d4-a716-446655440000",
            points_per_sphere=200,
            precision=20,
        )
        ```
    """
    try:
        simulation = Simulation.objects.get(id=simulation_id)
    except Simulation.DoesNotExist:
        raise ValueError(f"Simulation '{simulation_id}' not found")

    # Check simulation is completed
    if simulation.status != SimulationStatus.COMPLETED:
        raise ValueError(
            f"Simulation is not completed (status: {simulation.status}). "
            "Wait for completion before running analysis."
        )

    # Check geometry exists
    if simulation.geometry is None:
        raise ValueError(
            "Simulation has no geometry data. "
            "This may indicate a failed or incomplete simulation."
        )

    # Load geometry
    buf = io.BytesIO(simulation.geometry)
    geometry_array = np.load(buf)
    coords = np.ascontiguousarray(geometry_array[:, :3])
    radii = np.ascontiguousarray(geometry_array[:, 3])

    # Run box-counting
    import aglogen_core

    result = aglogen_core.box_counting_agglomerate(
        coords,
        radii,
        points_per_sphere=points_per_sphere,
        precision=precision,
    )

    # Store results in simulation metrics
    box_counting_results = {
        "dimension": float(result.dimension),
        "r_squared": float(result.r_squared),
        "std_error": float(result.std_error),
        "confidence_interval": list(result.confidence_interval),
        "log_scales": result.log_scales.tolist(),
        "log_values": result.log_values.tolist(),
        "execution_time_ms": int(result.execution_time_ms),
        "parameters": {
            "points_per_sphere": points_per_sphere,
            "precision": precision,
        },
    }

    # Update simulation metrics
    metrics = simulation.metrics or {}
    metrics["box_counting"] = box_counting_results
    simulation.metrics = metrics
    simulation.save(update_fields=["metrics"])

    return {
        "status": "completed",
        "simulation_id": str(simulation.id),
        "dimension": result.dimension,
        "r_squared": result.r_squared,
        "std_error": result.std_error,
        "confidence_interval_95": list(result.confidence_interval),
        "execution_time_ms": result.execution_time_ms,
        "message": f"Box-counting analysis complete: Df = {result.dimension:.3f} (R² = {result.r_squared:.4f})",
    }


@tool(
    name="get_box_counting_results",
    description="Get existing box-counting analysis results for a simulation",
    category="query",
    requires_project=False,
)
def get_box_counting_results_handler(
    simulation_id: str,
    user: Any = None,
) -> dict[str, Any]:
    """Get existing box-counting results for a simulation.

    Args:
        simulation_id: UUID of the simulation.
        user: The authenticated user.

    Returns:
        Dictionary with box-counting results or error if not analyzed.
    """
    try:
        simulation = Simulation.objects.get(id=simulation_id)
    except Simulation.DoesNotExist:
        raise ValueError(f"Simulation '{simulation_id}' not found")

    metrics = simulation.metrics or {}

    if "box_counting" not in metrics:
        # Check if simulation has metrics at all
        if simulation.status != SimulationStatus.COMPLETED:
            raise ValueError(
                f"Simulation is not completed (status: {simulation.status}). "
                "No box-counting results available."
            )
        raise ValueError(
            "No box-counting analysis found for this simulation. "
            "Use run_box_counting to analyze it first."
        )

    bc = metrics["box_counting"]

    return {
        "simulation_id": str(simulation.id),
        "simulation_name": simulation.name,
        "algorithm": simulation.algorithm,
        "n_particles": simulation.parameters.get("n_particles"),
        "dimension": bc["dimension"],
        "r_squared": bc["r_squared"],
        "std_error": bc.get("std_error"),
        "confidence_interval_95": bc.get("confidence_interval"),
        "parameters": bc.get("parameters"),
    }


@tool(
    name="run_fraktal_analysis",
    description="Run FRAKTAL 2D fractal analysis on a simulation projection",
    category="analysis",
    requires_project=True,
    is_async=True,
)
def run_fraktal_analysis_handler(
    simulation_id: str,
    model: str = "granulated_2012",
    npix: float = 10.0,
    dpo: float = 40.0,
    projection_axis: str = "z",
    project_id: str | None = None,
    name: str = "",
    auto_calibrate: bool = False,
    user: Any = None,
) -> dict[str, Any]:
    """Run FRAKTAL analysis on a simulation projection.

    FRAKTAL analyzes 2D projections of 3D agglomerates to extract
    morphological parameters like Df, Rg, kf, and npo.

    Args:
        simulation_id: UUID of the simulation to analyze.
        model: Analysis model - "granulated_2012" or "voxel_2018".
        npix: Pixels per 100nm in scale bar (calibration).
        dpo: Mean primary particle diameter in nm.
        projection_axis: Projection axis - "x", "y", "z", or "random".
        project_id: UUID of the project.
        name: Optional name for the analysis.
        auto_calibrate: Whether to auto-calibrate dpo.
        user: The authenticated user.

    Returns:
        Dictionary with analysis_id, task_id, and status.
    """
    if project_id is None:
        raise ValueError("project_id is required")

    # Validate project
    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        raise ValueError(f"Project '{project_id}' not found")

    # Validate simulation
    try:
        simulation = Simulation.objects.get(id=simulation_id)
    except Simulation.DoesNotExist:
        raise ValueError(f"Simulation '{simulation_id}' not found")

    if simulation.status != SimulationStatus.COMPLETED:
        raise ValueError(
            f"Simulation is not completed (status: {simulation.status}). "
            "Wait for completion before running FRAKTAL analysis."
        )

    if simulation.geometry is None:
        raise ValueError("Simulation has no geometry data.")

    # Validate model
    valid_models = ["granulated_2012", "voxel_2018"]
    if model.lower() not in valid_models:
        raise ValueError(f"Invalid model '{model}'. Valid options: {valid_models}")

    # Set projection parameters based on axis
    import random

    if projection_axis.lower() == "random":
        azimuth = random.uniform(0, 360)
        elevation = random.uniform(-90, 90)
    else:
        axis_params = {
            "x": (90, 0),
            "y": (0, 0),
            "z": (0, 90),
        }
        if projection_axis.lower() not in axis_params:
            raise ValueError(
                f"Invalid projection_axis '{projection_axis}'. "
                "Valid options: x, y, z, random"
            )
        azimuth, elevation = axis_params[projection_axis.lower()]

    # Create FRAKTAL analysis
    analysis = FraktalAnalysis.objects.create(
        project=project,
        name=name or f"FRAKTAL - {simulation.name or simulation.algorithm}",
        source_type=SourceType.SIMULATION_PROJECTION,
        simulation=simulation,
        model=model.lower(),
        npix=npix,
        dpo=dpo,
        auto_calibrate=auto_calibrate,
        projection_params={
            "azimuth": azimuth,
            "elevation": elevation,
            "resolution": 512,
        },
        status=AnalysisStatus.QUEUED,
    )

    # Queue Celery task
    from apps.fractal_analysis.tasks import (
        run_fraktal_analysis_task,
        run_fraktal_auto_calibrate_task,
    )

    if auto_calibrate:
        task = run_fraktal_auto_calibrate_task.delay(str(analysis.id))
    else:
        task = run_fraktal_analysis_task.delay(str(analysis.id))

    return {
        "status": "queued",
        "analysis_id": str(analysis.id),
        "task_id": task.id,
        "simulation_id": str(simulation.id),
        "model": model.lower(),
        "projection_axis": projection_axis.lower(),
        "auto_calibrate": auto_calibrate,
        "message": f"FRAKTAL analysis queued for simulation '{simulation.name or simulation.id}'",
    }


@tool(
    name="run_fraktal_from_image",
    description="Run FRAKTAL 2D fractal analysis on an uploaded image",
    category="analysis",
    requires_project=True,
    is_async=True,
)
def run_fraktal_from_image_handler(
    image_base64: str,
    npix: float,
    dpo: float,
    project_id: str | None = None,
    model: str = "granulated_2012",
    filename: str = "uploaded_image.png",
    name: str = "",
    auto_calibrate: bool = False,
    user: Any = None,
) -> dict[str, Any]:
    """Run FRAKTAL analysis on an uploaded image.

    Args:
        image_base64: Base64-encoded image data.
        npix: Pixels per 100nm in scale bar (calibration).
        dpo: Mean primary particle diameter in nm.
        project_id: UUID of the project.
        model: Analysis model - "granulated_2012" or "voxel_2018".
        filename: Original filename for reference.
        name: Optional name for the analysis.
        auto_calibrate: Whether to auto-calibrate dpo.
        user: The authenticated user.

    Returns:
        Dictionary with analysis_id, task_id, and status.
    """
    import base64

    if project_id is None:
        raise ValueError("project_id is required")

    # Validate project
    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        raise ValueError(f"Project '{project_id}' not found")

    # Decode image
    try:
        image_data = base64.b64decode(image_base64)
    except Exception as e:
        raise ValueError(f"Invalid base64 image data: {e}")

    # Validate model
    valid_models = ["granulated_2012", "voxel_2018"]
    if model.lower() not in valid_models:
        raise ValueError(f"Invalid model '{model}'. Valid options: {valid_models}")

    # Determine content type from filename
    ext = filename.lower().split(".")[-1]
    content_types = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "tif": "image/tiff",
        "tiff": "image/tiff",
        "bmp": "image/bmp",
    }
    content_type = content_types.get(ext, "image/png")

    # Create FRAKTAL analysis
    analysis = FraktalAnalysis.objects.create(
        project=project,
        name=name or f"FRAKTAL - {filename}",
        source_type=SourceType.UPLOADED_IMAGE,
        original_image=image_data,
        original_filename=filename,
        original_content_type=content_type,
        model=model.lower(),
        npix=npix,
        dpo=dpo,
        auto_calibrate=auto_calibrate,
        status=AnalysisStatus.QUEUED,
    )

    # Queue Celery task
    from apps.fractal_analysis.tasks import (
        run_fraktal_analysis_task,
        run_fraktal_auto_calibrate_task,
    )

    if auto_calibrate:
        task = run_fraktal_auto_calibrate_task.delay(str(analysis.id))
    else:
        task = run_fraktal_analysis_task.delay(str(analysis.id))

    return {
        "status": "queued",
        "analysis_id": str(analysis.id),
        "task_id": task.id,
        "filename": filename,
        "model": model.lower(),
        "auto_calibrate": auto_calibrate,
        "message": f"FRAKTAL analysis queued for image '{filename}'",
    }


@tool(
    name="get_fraktal_results",
    description="Get FRAKTAL analysis results by analysis ID",
    category="query",
    requires_project=False,
)
def get_fraktal_results_handler(
    analysis_id: str,
    user: Any = None,
) -> dict[str, Any]:
    """Get FRAKTAL analysis results.

    Args:
        analysis_id: UUID of the FRAKTAL analysis.
        user: The authenticated user.

    Returns:
        Dictionary with Df, Rg, kf, npo, and other morphological parameters.
    """
    try:
        analysis = FraktalAnalysis.objects.get(id=analysis_id)
    except FraktalAnalysis.DoesNotExist:
        raise ValueError(f"FRAKTAL analysis '{analysis_id}' not found")

    if analysis.status == AnalysisStatus.QUEUED:
        return {
            "analysis_id": str(analysis.id),
            "status": "queued",
            "message": "Analysis is queued and waiting to start.",
        }

    if analysis.status == AnalysisStatus.RUNNING:
        return {
            "analysis_id": str(analysis.id),
            "status": "running",
            "message": "Analysis is currently running.",
        }

    if analysis.status == AnalysisStatus.FAILED:
        return {
            "analysis_id": str(analysis.id),
            "status": "failed",
            "error": analysis.error_message,
        }

    # Analysis completed
    results = analysis.results or {}

    return {
        "analysis_id": str(analysis.id),
        "name": analysis.name,
        "status": "completed",
        "model": analysis.model,
        "source_type": analysis.source_type,
        "simulation_id": str(analysis.simulation_id) if analysis.simulation else None,
        # Morphological parameters
        "df": results.get("df"),
        "rg": results.get("rg"),
        "kf": results.get("kf"),
        "npo": results.get("npo"),
        "npo_visual": results.get("npo_visual"),
        "ap": results.get("ap"),
        # Additional parameters
        "volume": results.get("volume"),
        "mass": results.get("mass"),
        "surface_area": results.get("surface_area"),
        # Quality indicators
        "npo_aligned": results.get("npo_aligned"),
        "npo_ratio": results.get("npo_ratio"),
        # Timing
        "execution_time_ms": analysis.execution_time_ms,
    }


@tool(
    name="compare_simulations",
    description="Compare metrics across multiple simulations",
    category="analysis",
    requires_project=False,
)
def compare_simulations_handler(
    simulation_ids: list[str],
    metrics: list[str] | None = None,
    user: Any = None,
) -> dict[str, Any]:
    """Compare metrics across multiple simulations.

    Args:
        simulation_ids: List of simulation UUIDs to compare (2-20 items).
        metrics: List of metrics to compare. Defaults to ["df", "rg", "porosity"].
        user: The authenticated user.

    Returns:
        Dictionary with per-metric statistics and individual values.
    """
    # Validate count
    if len(simulation_ids) < 2:
        raise ValueError("At least 2 simulations are required for comparison")
    if len(simulation_ids) > 20:
        raise ValueError("Maximum 20 simulations can be compared at once")

    # Default metrics
    if metrics is None:
        metrics = ["fractal_dimension", "radius_of_gyration", "porosity"]

    # Normalize metric names
    metric_aliases = {
        "df": "fractal_dimension",
        "rg": "radius_of_gyration",
        "kf": "prefactor",
        "n_particles": "n_particles",
    }
    normalized_metrics = [metric_aliases.get(m.lower(), m.lower()) for m in metrics]

    # Load simulations
    simulations = []
    for sim_id in simulation_ids:
        try:
            sim = Simulation.objects.get(id=sim_id)
            simulations.append(sim)
        except Simulation.DoesNotExist:
            raise ValueError(f"Simulation '{sim_id}' not found")

    # Extract metrics for each simulation
    comparison_data = {metric: [] for metric in normalized_metrics}
    simulation_details = []

    for sim in simulations:
        sim_metrics = sim.metrics or {}
        params = sim.parameters or {}

        detail = {
            "simulation_id": str(sim.id),
            "name": sim.name,
            "algorithm": sim.algorithm,
            "status": sim.status,
        }

        for metric in normalized_metrics:
            value = None
            if metric == "n_particles":
                value = params.get("n_particles")
            elif metric in sim_metrics:
                value = sim_metrics[metric]
            elif metric == "fractal_dimension" and "box_counting" in sim_metrics:
                value = sim_metrics["box_counting"].get("dimension")

            detail[metric] = value
            if value is not None:
                comparison_data[metric].append(value)

        simulation_details.append(detail)

    # Compute statistics for each metric
    statistics = {}
    for metric in normalized_metrics:
        values = comparison_data[metric]
        if len(values) > 0:
            statistics[metric] = {
                "min": round(min(values), 4),
                "max": round(max(values), 4),
                "mean": round(sum(values) / len(values), 4),
                "range": round(max(values) - min(values), 4),
                "count": len(values),
            }
            if len(values) > 1:
                variance = sum((x - statistics[metric]["mean"]) ** 2 for x in values) / len(values)
                statistics[metric]["std"] = round(variance ** 0.5, 4)
        else:
            statistics[metric] = {
                "error": f"No data available for metric '{metric}'",
            }

    return {
        "simulation_count": len(simulations),
        "metrics_compared": normalized_metrics,
        "statistics": statistics,
        "simulations": simulation_details,
    }


@tool(
    name="analyze_parametric_study",
    description="Analyze all simulations in a parametric study and compute aggregated metrics",
    category="analysis",
    requires_project=False,
    is_async=True,
)
def analyze_parametric_study_handler(
    study_id: str,
    run_missing_analysis: bool = False,
    user: Any = None,
) -> dict[str, Any]:
    """Analyze a parametric study and aggregate results.

    Computes statistics grouped by varied parameter values.

    Args:
        study_id: UUID of the parametric study.
        run_missing_analysis: Whether to run box-counting on simulations without it.
        user: The authenticated user.

    Returns:
        Dictionary with per-parameter-value statistics and trends.
    """
    try:
        study = ParametricStudy.objects.get(id=study_id)
    except ParametricStudy.DoesNotExist:
        raise ValueError(f"Parametric study '{study_id}' not found")

    # Get completed simulations
    simulations = study.simulations.filter(status=SimulationStatus.COMPLETED)
    total_sims = study.simulations.count()
    completed_sims = simulations.count()

    if completed_sims == 0:
        return {
            "study_id": str(study.id),
            "study_name": study.name,
            "status": "no_completed_simulations",
            "total_simulations": total_sims,
            "completed_simulations": 0,
            "message": "No simulations have completed yet.",
        }

    # Collect data grouped by parameter values
    varied_params = list(study.parameter_grid.keys())
    grouped_data: dict[str, dict[Any, list[dict]]] = {param: {} for param in varied_params}

    missing_analysis = []

    for sim in simulations:
        metrics = sim.metrics or {}
        params = sim.parameters or {}

        # Check for box-counting
        if "box_counting" not in metrics:
            missing_analysis.append(str(sim.id))

        # Extract key metrics
        df = metrics.get("fractal_dimension")
        if df is None and "box_counting" in metrics:
            df = metrics["box_counting"].get("dimension")

        rg = metrics.get("radius_of_gyration")
        porosity = metrics.get("porosity")

        sim_data = {
            "simulation_id": str(sim.id),
            "df": df,
            "rg": rg,
            "porosity": porosity,
            "parameters": params,
        }

        # Group by each varied parameter
        for param in varied_params:
            value = params.get(param)
            if value is not None:
                # Convert to string for dict key (handles floats)
                key = str(value)
                if key not in grouped_data[param]:
                    grouped_data[param][key] = []
                grouped_data[param][key].append(sim_data)

    # Compute statistics per parameter value
    parameter_analysis = {}

    for param in varied_params:
        param_stats = {}
        for value_key, sims in grouped_data[param].items():
            df_values = [s["df"] for s in sims if s["df"] is not None]
            rg_values = [s["rg"] for s in sims if s["rg"] is not None]

            stats = {
                "count": len(sims),
                "parameter_value": value_key,
            }

            if df_values:
                stats["df_mean"] = round(sum(df_values) / len(df_values), 4)
                if len(df_values) > 1:
                    variance = sum((x - stats["df_mean"]) ** 2 for x in df_values) / len(df_values)
                    stats["df_std"] = round(variance ** 0.5, 4)

            if rg_values:
                stats["rg_mean"] = round(sum(rg_values) / len(rg_values), 4)

            param_stats[value_key] = stats

        # Sort by parameter value
        try:
            sorted_keys = sorted(param_stats.keys(), key=lambda x: float(x))
        except ValueError:
            sorted_keys = sorted(param_stats.keys())

        parameter_analysis[param] = {
            "values": [param_stats[k] for k in sorted_keys],
            "trend": _compute_trend(
                [param_stats[k] for k in sorted_keys]
            ) if len(sorted_keys) > 1 else None,
        }

    result = {
        "study_id": str(study.id),
        "study_name": study.name,
        "algorithm": study.base_algorithm,
        "status": "analyzed",
        "total_simulations": total_sims,
        "completed_simulations": completed_sims,
        "varied_parameters": varied_params,
        "parameter_analysis": parameter_analysis,
    }

    if missing_analysis:
        result["missing_box_counting"] = len(missing_analysis)
        if run_missing_analysis:
            result["analysis_queued"] = len(missing_analysis)
            result["message"] = f"Queued box-counting for {len(missing_analysis)} simulations"
        else:
            result["message"] = (
                f"{len(missing_analysis)} simulations missing box-counting analysis. "
                "Set run_missing_analysis=True to run them."
            )

    return result


def _compute_trend(values: list[dict]) -> dict | None:
    """Compute trend direction for Df values."""
    if len(values) < 2:
        return None

    df_values = [v.get("df_mean") for v in values if v.get("df_mean") is not None]
    if len(df_values) < 2:
        return None

    # Simple linear trend
    first = df_values[0]
    last = df_values[-1]
    change = last - first

    if abs(change) < 0.05:
        direction = "stable"
    elif change > 0:
        direction = "increasing"
    else:
        direction = "decreasing"

    return {
        "direction": direction,
        "change": round(change, 4),
        "first_value": round(first, 4),
        "last_value": round(last, 4),
    }


@tool(
    name="list_analyses",
    description="List fractal analyses in a project or for a simulation",
    category="query",
    requires_project=False,
)
def list_analyses_handler(
    project_id: str | None = None,
    simulation_id: str | None = None,
    analysis_type: str | None = None,
    limit: int = 20,
    user: Any = None,
) -> dict[str, Any]:
    """List fractal analyses.

    Args:
        project_id: Optional project UUID to filter by.
        simulation_id: Optional simulation UUID to filter by.
        analysis_type: Optional filter - "fraktal" or "image".
        limit: Maximum number of results (default 20, max 100).
        user: The authenticated user.

    Returns:
        Dictionary with list of analyses.
    """
    # Validate inputs
    if project_id is None and simulation_id is None:
        raise ValueError("Either project_id or simulation_id is required")

    limit = max(1, min(limit, 100))

    results = []

    # Query FRAKTAL analyses
    if analysis_type is None or analysis_type.lower() == "fraktal":
        fraktal_qs = FraktalAnalysis.objects.all()

        if project_id:
            fraktal_qs = fraktal_qs.filter(project_id=project_id)
        if simulation_id:
            fraktal_qs = fraktal_qs.filter(simulation_id=simulation_id)

        for analysis in fraktal_qs[:limit]:
            fraktal_results = analysis.results or {}
            results.append({
                "analysis_id": str(analysis.id),
                "type": "fraktal",
                "name": analysis.name,
                "model": analysis.model,
                "source_type": analysis.source_type,
                "simulation_id": str(analysis.simulation_id) if analysis.simulation else None,
                "status": analysis.status,
                "df": fraktal_results.get("df"),
                "rg": fraktal_results.get("rg"),
                "created_at": analysis.created_at.isoformat(),
            })

    # Query Image analyses (box-counting, etc.)
    if analysis_type is None or analysis_type.lower() == "image":
        image_qs = ImageAnalysis.objects.all()

        if project_id:
            image_qs = image_qs.filter(project_id=project_id)

        remaining = limit - len(results)
        if remaining > 0:
            for analysis in image_qs[:remaining]:
                image_results = analysis.results or {}
                results.append({
                    "analysis_id": str(analysis.id),
                    "type": "image",
                    "method": analysis.method,
                    "status": analysis.status,
                    "df": image_results.get("fractal_dimension"),
                    "r_squared": image_results.get("r_squared"),
                    "created_at": analysis.created_at.isoformat(),
                })

    return {
        "count": len(results),
        "project_id": project_id,
        "simulation_id": simulation_id,
        "analyses": results,
    }


# Export tool definitions
run_box_counting_tool = run_box_counting_handler
get_box_counting_results_tool = get_box_counting_results_handler
run_fraktal_analysis_tool = run_fraktal_analysis_handler
run_fraktal_from_image_tool = run_fraktal_from_image_handler
get_fraktal_results_tool = get_fraktal_results_handler
compare_simulations_tool = compare_simulations_handler
analyze_parametric_study_tool = analyze_parametric_study_handler
list_analyses_tool = list_analyses_handler
