"""Tool registration for AI Assistant.

This module handles the registration of all tools at application startup.
"""

import logging

from .registry import ToolRegistry

logger = logging.getLogger(__name__)


def register_all_tools(registry: ToolRegistry) -> None:
    """Register all available tools with the registry.

    This function is called during Django app initialization to
    populate the tool registry with all available tools.

    Args:
        registry: The tool registry to populate.
    """
    # Import utility tool definitions
    from .utility_tools import (
        check_task_status_tool,
        get_project_info_tool,
        get_simulation_details_tool,
        list_algorithms_tool,
        list_simulations_tool,
    )

    # Import simulation tool definitions
    from .simulation_tools import (
        run_ballistic_cc_simulation_tool,
        run_ballistic_simulation_tool,
        run_cca_simulation_tool,
        run_dla_simulation_tool,
        run_limiting_case_tool,
        run_simulation_tool,
        run_tunable_simulation_tool,
    )

    # Import parametric study tool definitions
    from .study_tools import (
        cancel_study_tool,
        create_parametric_study_tool,
        get_study_results_tool,
        get_study_status_tool,
        list_studies_tool,
    )

    # Import analysis tool definitions
    from .analysis_tools import (
        analyze_parametric_study_tool,
        compare_simulations_tool,
        get_box_counting_results_tool,
        get_fraktal_results_tool,
        list_analyses_tool,
        run_box_counting_tool,
        run_fraktal_analysis_tool,
        run_fraktal_from_image_tool,
    )

    # Utility tools
    registry.register(list_algorithms_tool)
    registry.register(get_project_info_tool)
    registry.register(check_task_status_tool)
    registry.register(list_simulations_tool)
    registry.register(get_simulation_details_tool)

    # Simulation tools
    registry.register(run_simulation_tool)
    registry.register(run_dla_simulation_tool)
    registry.register(run_cca_simulation_tool)
    registry.register(run_ballistic_simulation_tool)
    registry.register(run_ballistic_cc_simulation_tool)
    registry.register(run_tunable_simulation_tool)
    registry.register(run_limiting_case_tool)

    # Parametric study tools
    registry.register(create_parametric_study_tool)
    registry.register(get_study_status_tool)
    registry.register(get_study_results_tool)
    registry.register(list_studies_tool)
    registry.register(cancel_study_tool)

    # Analysis tools
    registry.register(run_box_counting_tool)
    registry.register(get_box_counting_results_tool)
    registry.register(run_fraktal_analysis_tool)
    registry.register(run_fraktal_from_image_tool)
    registry.register(get_fraktal_results_tool)
    registry.register(compare_simulations_tool)
    registry.register(analyze_parametric_study_tool)
    registry.register(list_analyses_tool)

    logger.info(f"Registered {len(registry)} AI tools")
