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
    # Import tool definitions
    from .utility_tools import (
        check_task_status_tool,
        get_project_info_tool,
        get_simulation_details_tool,
        list_algorithms_tool,
        list_simulations_tool,
    )

    # Utility tools
    registry.register(list_algorithms_tool)
    registry.register(get_project_info_tool)
    registry.register(check_task_status_tool)
    registry.register(list_simulations_tool)
    registry.register(get_simulation_details_tool)

    logger.info(f"Registered {len(registry)} AI tools")
