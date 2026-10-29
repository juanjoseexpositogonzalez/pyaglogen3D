"""Document chunking strategies for RAG indexing."""

from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from apps.simulations.models import Simulation
    from apps.fractal_analysis.models import FraktalAnalysis
    from apps.rag.models import IndexedDocument


def chunk_simulation_data(
    content: str, simulation: "Simulation"
) -> list[dict[str, Any]]:
    """Chunk simulation data with domain-specific strategy.

    For simulations, we create semantic chunks:
    1. Overview chunk (algorithm, parameters)
    2. Results chunk (metrics)

    Args:
        content: Full text content of the simulation.
        simulation: The Simulation object.

    Returns:
        List of chunk dictionaries with content, section, and metadata.
    """
    chunks = []

    # Overview chunk
    overview = _build_simulation_overview(simulation)
    chunks.append({
        "content": overview,
        "section": "overview",
        "metadata": {"chunk_type": "overview"},
    })

    # Results chunk (if metrics exist)
    if simulation.metrics:
        results = _build_simulation_results(simulation.metrics)
        chunks.append({
            "content": results,
            "section": "results",
            "metadata": {"chunk_type": "results"},
        })

    return chunks


def chunk_analysis_data(
    content: str, analysis: "FraktalAnalysis"
) -> list[dict[str, Any]]:
    """Chunk FRAKTAL analysis data.

    Args:
        content: Full text content of the analysis.
        analysis: The FraktalAnalysis object.

    Returns:
        List of chunk dictionaries.
    """
    chunks = []

    # Overview chunk
    overview = _build_analysis_overview(analysis)
    chunks.append({
        "content": overview,
        "section": "overview",
        "metadata": {"chunk_type": "overview"},
    })

    # Results chunk (if results exist)
    if analysis.results:
        results = _build_analysis_results(analysis.results)
        chunks.append({
            "content": results,
            "section": "results",
            "metadata": {"chunk_type": "results"},
        })

    return chunks


def chunk_scientific_document(
    content: str, document: "IndexedDocument"
) -> list[dict[str, Any]]:
    """Chunk scientific document with overlap for context preservation.

    Uses sentence-aware chunking with ~500 token chunks and 50 token overlap.

    Args:
        content: Full text content of the document.
        document: The IndexedDocument object.

    Returns:
        List of chunk dictionaries.
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=2000,  # ~500 tokens
        chunk_overlap=200,  # ~50 tokens
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    texts = splitter.split_text(content)

    chunks = []
    for i, text in enumerate(texts):
        chunks.append({
            "content": text,
            "section": "",
            "metadata": {"chunk_type": "scientific"},
        })

    return chunks


def _build_simulation_overview(simulation: "Simulation") -> str:
    """Build overview chunk for simulation."""
    parts = [
        "Simulation Overview:",
        f"Algorithm: {simulation.algorithm.upper()} ({simulation.get_algorithm_display()})",
        f"Particles: {simulation.parameters.get('n_particles', 'N/A')}",
        f"Seed: {simulation.seed}",
        "",
        "Parameters:",
    ]

    # Add all parameters
    param_descriptions = {
        "n_particles": "Number of particles",
        "sticking_probability": "Sticking probability",
        "particle_radius": "Particle radius",
        "max_attempts": "Maximum walk attempts",
        "grid_size": "Grid size",
        "fractal_dimension": "Target fractal dimension",
        "prefactor": "Target prefactor",
        "n_primary": "Primary particles per cluster",
        "sigma": "Size distribution sigma",
        "sintering_coefficient": "Sintering coefficient",
    }

    for key, value in simulation.parameters.items():
        desc = param_descriptions.get(key, key.replace("_", " ").title())
        parts.append(f"  - {desc}: {value}")

    return "\n".join(parts)


def _build_simulation_results(metrics: dict[str, Any]) -> str:
    """Build results chunk from simulation metrics."""
    parts = ["Simulation Results:"]

    # Key metrics with descriptions
    metric_info = [
        ("fractal_dimension", "Fractal Dimension (Df)", ".4f"),
        ("fractal_dimension_std", "  Standard Deviation", ".4f"),
        ("prefactor", "Prefactor (kf)", ".4f"),
        ("radius_of_gyration", "Radius of Gyration (Rg)", ".4f"),
        ("porosity", "Porosity", ".4f"),
        ("overlap_volume", "Overlap Volume", ".4f"),
    ]

    for key, label, fmt in metric_info:
        if key in metrics:
            value = metrics[key]
            if isinstance(value, float):
                parts.append(f"  - {label}: {value:{fmt}}")
            else:
                parts.append(f"  - {label}: {value}")

    # Coordination number (nested dict)
    if "coordination" in metrics:
        coord = metrics["coordination"]
        if isinstance(coord, dict):
            mean = coord.get("mean", "N/A")
            std = coord.get("std", "N/A")
            if isinstance(mean, float):
                parts.append(f"  - Coordination Number: {mean:.2f} (std: {std:.2f})")
            else:
                parts.append(f"  - Coordination Number: {mean}")

    return "\n".join(parts)


def _build_analysis_overview(analysis: "FraktalAnalysis") -> str:
    """Build overview chunk for FRAKTAL analysis."""
    parts = [
        "FRAKTAL Analysis Overview:",
        f"Model: {analysis.model.upper()} ({analysis.get_model_display()})",
        f"Source: {analysis.get_source_type_display()}",
        "",
        "Analysis Parameters:",
    ]

    # Key parameters
    param_info = [
        ("npix", "Image resolution (npix)"),
        ("dpo", "Primary particle diameter (dpo)"),
        ("delta", "Pixel size (delta)"),
        ("correction_3d", "3D correction"),
        ("pixel_min", "Minimum pixel count"),
        ("pixel_max", "Maximum pixel count"),
        ("npo_limit", "NPO limit"),
        ("escala", "Scale factor"),
        ("auto_calibrate", "Auto-calibrated"),
    ]

    for key, label in param_info:
        value = getattr(analysis, key, None)
        if value is not None:
            parts.append(f"  - {label}: {value}")

    return "\n".join(parts)


def _build_analysis_results(results: dict[str, Any]) -> str:
    """Build results chunk from FRAKTAL analysis results."""
    parts = ["FRAKTAL Analysis Results:"]

    # Key results with descriptions
    result_info = [
        ("df", "Fractal Dimension (Df)", ".4f"),
        ("rg", "Radius of Gyration (Rg)", ".4f"),
        ("ap", "Primary Particle Area (Ap)", ".4f"),
        ("npo", "Number of Primary Particles (Npo)", ".1f"),
        ("kf", "Prefactor (kf)", ".4f"),
        ("zf", "Zf coefficient", ".4f"),
        ("jf", "Jf coefficient", ".4f"),
        ("volume", "Volume", ".4f"),
        ("mass", "Mass", ".4f"),
        ("surface_area", "Surface Area", ".4f"),
    ]

    for key, label, fmt in result_info:
        if key in results:
            value = results[key]
            if isinstance(value, float):
                parts.append(f"  - {label}: {value:{fmt}}")
            else:
                parts.append(f"  - {label}: {value}")

    return "\n".join(parts)
