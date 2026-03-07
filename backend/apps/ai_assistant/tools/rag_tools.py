"""RAG tools for the AI assistant.

These tools allow the AI to search the knowledge base containing:
- Past simulation results (fractal dimensions, parameters, metrics)
- FRAKTAL analysis results
- Scientific documentation about DLA, CCA, fractal analysis
"""

import logging
from typing import Any

from .decorators import tool

logger = logging.getLogger(__name__)


@tool(
    name="search_knowledge_base",
    description="""Search the knowledge base for relevant information.

Use this tool to find:
- Results from past simulations (fractal dimensions, parameters, etc.)
- FRAKTAL analysis results
- Scientific literature about DLA, CCA, and fractal analysis

The search uses semantic similarity, so natural language queries work well.

Examples:
- "What Df values have I seen for DLA with 1000 particles?"
- "How does sticking probability affect fractal dimension?"
- "Find information about cluster-cluster aggregation"
- "What were the results of my recent analyses?"
""",
    category="knowledge",
    requires_project=False,
    is_async=False,
)
def search_knowledge_base_handler(
    query: str,
    source_type: str | None = None,
    max_results: int = 5,
    user: Any = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Search the RAG knowledge base.

    Args:
        query: Natural language search query.
        source_type: Filter by type: simulation, analysis, scientific_doc.
        max_results: Maximum results to return (1-10).
        user: The authenticated user (auto-injected).

    Returns:
        Dictionary with search results.
    """
    if not user:
        return {
            "success": False,
            "error": {
                "error_type": "AuthenticationError",
                "message": "User context required for knowledge base search",
            },
        }

    # Validate max_results
    max_results = min(max(1, max_results), 10)

    # Parse source type filter
    source_types = None
    if source_type:
        valid_types = ["simulation", "analysis", "scientific_doc"]
        if source_type in valid_types:
            source_types = [source_type]
        else:
            return {
                "success": False,
                "error": {
                    "error_type": "ValidationError",
                    "message": f"Invalid source_type. Must be one of: {valid_types}",
                },
            }

    try:
        from apps.rag.services.search_service import get_search_service

        search_service = get_search_service()
        results = search_service.search(
            query=query,
            user=user,
            k=max_results,
            source_types=source_types,
        )

        if not results:
            return {
                "success": True,
                "found": False,
                "message": "No relevant results found in the knowledge base.",
                "results": [],
            }

        return {
            "success": True,
            "found": True,
            "count": len(results),
            "results": [r.to_dict() for r in results],
        }

    except Exception as e:
        logger.exception(f"Knowledge base search failed: {e}")
        return {
            "success": False,
            "error": {
                "error_type": "SearchError",
                "message": f"Knowledge base search failed: {str(e)}",
            },
        }


@tool(
    name="get_simulation_insights",
    description="""Get aggregated insights and statistics from past simulations.

Use this to answer questions like:
- "What's the typical Df range for DLA simulations?"
- "How many simulations have I run with a specific algorithm?"
- "Show statistics for simulations with >1000 particles"

This tool provides aggregated statistics rather than individual results.
For finding specific simulations, use search_knowledge_base instead.
""",
    category="knowledge",
    requires_project=False,
    is_async=False,
)
def get_simulation_insights_handler(
    algorithm: str | None = None,
    min_particles: int | None = None,
    user: Any = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Get statistical insights from indexed simulations.

    Args:
        algorithm: Filter by algorithm (dla, cca, ballistic, etc.).
        min_particles: Minimum particle count filter.
        user: The authenticated user (auto-injected).

    Returns:
        Aggregated statistics and insights.
    """
    if not user:
        return {
            "success": False,
            "error": {
                "error_type": "AuthenticationError",
                "message": "User context required",
            },
        }

    try:
        from apps.rag.models import IndexedDocument, DocumentSource, DocumentStatus
        import statistics

        # Query indexed simulations
        queryset = IndexedDocument.objects.filter(
            owner=user,
            source_type=DocumentSource.SIMULATION,
            status=DocumentStatus.READY,
        )

        # Apply filters via metadata
        if algorithm:
            queryset = queryset.filter(metadata__algorithm=algorithm.lower())

        if min_particles:
            queryset = queryset.filter(metadata__n_particles__gte=min_particles)

        # Count and extract statistics
        count = queryset.count()

        if count == 0:
            return {
                "success": True,
                "found": False,
                "message": "No indexed simulations match the criteria.",
                "filters_applied": {
                    "algorithm": algorithm,
                    "min_particles": min_particles,
                },
            }

        # Extract Df values from metadata
        df_values = [
            doc.metadata.get("fractal_dimension")
            for doc in queryset
            if doc.metadata.get("fractal_dimension") is not None
        ]

        stats = {}
        if df_values:
            stats["fractal_dimension"] = {
                "mean": round(statistics.mean(df_values), 4),
                "std": round(statistics.stdev(df_values), 4) if len(df_values) > 1 else 0,
                "min": round(min(df_values), 4),
                "max": round(max(df_values), 4),
                "count": len(df_values),
            }

        # Get algorithm distribution
        algorithm_counts = {}
        for doc in queryset:
            alg = doc.metadata.get("algorithm", "unknown")
            algorithm_counts[alg] = algorithm_counts.get(alg, 0) + 1

        return {
            "success": True,
            "found": True,
            "total_simulations": count,
            "filters_applied": {
                "algorithm": algorithm,
                "min_particles": min_particles,
            },
            "statistics": stats,
            "algorithm_distribution": algorithm_counts,
        }

    except Exception as e:
        logger.exception(f"Failed to get simulation insights: {e}")
        return {
            "success": False,
            "error": {
                "error_type": "InternalError",
                "message": f"Failed to get simulation insights: {str(e)}",
            },
        }


@tool(
    name="get_analysis_insights",
    description="""Get aggregated insights from FRAKTAL analyses.

Use this to understand patterns in your analysis results:
- "What Df values have I measured?"
- "How do my analyses compare across different images?"
""",
    category="knowledge",
    requires_project=False,
    is_async=False,
)
def get_analysis_insights_handler(
    model: str | None = None,
    user: Any = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Get statistical insights from indexed analyses.

    Args:
        model: Filter by FRAKTAL model (granulated_2012, voxel_2018).
        user: The authenticated user (auto-injected).

    Returns:
        Aggregated statistics and insights.
    """
    if not user:
        return {
            "success": False,
            "error": {
                "error_type": "AuthenticationError",
                "message": "User context required",
            },
        }

    try:
        from apps.rag.models import IndexedDocument, DocumentSource, DocumentStatus
        import statistics

        # Query indexed analyses
        queryset = IndexedDocument.objects.filter(
            owner=user,
            source_type=DocumentSource.ANALYSIS,
            status=DocumentStatus.READY,
        )

        # Apply model filter
        if model:
            queryset = queryset.filter(metadata__model=model.lower())

        count = queryset.count()

        if count == 0:
            return {
                "success": True,
                "found": False,
                "message": "No indexed analyses match the criteria.",
                "filters_applied": {"model": model},
            }

        # Extract Df values from metadata
        df_values = [
            doc.metadata.get("fractal_dimension")
            for doc in queryset
            if doc.metadata.get("fractal_dimension") is not None
        ]

        stats = {}
        if df_values:
            stats["fractal_dimension"] = {
                "mean": round(statistics.mean(df_values), 4),
                "std": round(statistics.stdev(df_values), 4) if len(df_values) > 1 else 0,
                "min": round(min(df_values), 4),
                "max": round(max(df_values), 4),
                "count": len(df_values),
            }

        # Get model distribution
        model_counts = {}
        for doc in queryset:
            m = doc.metadata.get("model", "unknown")
            model_counts[m] = model_counts.get(m, 0) + 1

        return {
            "success": True,
            "found": True,
            "total_analyses": count,
            "filters_applied": {"model": model},
            "statistics": stats,
            "model_distribution": model_counts,
        }

    except Exception as e:
        logger.exception(f"Failed to get analysis insights: {e}")
        return {
            "success": False,
            "error": {
                "error_type": "InternalError",
                "message": f"Failed to get analysis insights: {str(e)}",
            },
        }
