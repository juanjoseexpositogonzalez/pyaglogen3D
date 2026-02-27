"""Tool Registry for AI Assistant.

Provides a singleton registry that manages all available tools.
Tools are registered at application startup and can be retrieved
by the AI service for execution.
"""

import logging
from typing import Any

from .base import ToolDefinition

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Singleton registry for AI tools.

    Manages registration, retrieval, and formatting of tools
    for different AI providers.

    Example:
        registry = get_registry()
        registry.register(my_tool_definition)
        tools = registry.to_anthropic_format()
    """

    _instance: "ToolRegistry | None" = None
    _initialized: bool = False

    def __new__(cls) -> "ToolRegistry":
        """Ensure only one instance exists."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        """Initialize the registry (only once)."""
        if self._initialized:
            return
        self._tools: dict[str, ToolDefinition] = {}
        self._initialized = True
        logger.info("Tool registry initialized")

    def register(self, tool: ToolDefinition) -> None:
        """Register a tool with the registry.

        Args:
            tool: The tool definition to register.

        Raises:
            ValueError: If a tool with the same name already exists.
        """
        if tool.name in self._tools:
            logger.warning(
                f"Tool '{tool.name}' already registered. Overwriting.",
            )
        self._tools[tool.name] = tool
        logger.debug(f"Registered tool: {tool.name} (category: {tool.category})")

    def unregister(self, name: str) -> bool:
        """Remove a tool from the registry.

        Args:
            name: The name of the tool to remove.

        Returns:
            True if the tool was removed, False if not found.
        """
        if name in self._tools:
            del self._tools[name]
            logger.debug(f"Unregistered tool: {name}")
            return True
        return False

    def get_tool(self, name: str) -> ToolDefinition | None:
        """Get a tool by name.

        Args:
            name: The name of the tool.

        Returns:
            The tool definition, or None if not found.
        """
        return self._tools.get(name)

    def get_all_tools(self) -> list[ToolDefinition]:
        """Get all registered tools.

        Returns:
            List of all tool definitions.
        """
        return list(self._tools.values())

    def get_tools_by_category(self, category: str) -> list[ToolDefinition]:
        """Get tools filtered by category.

        Args:
            category: The category to filter by.

        Returns:
            List of tool definitions in the specified category.
        """
        return [t for t in self._tools.values() if t.category == category]

    def get_categories(self) -> list[str]:
        """Get all unique tool categories.

        Returns:
            List of category names.
        """
        return list({t.category for t in self._tools.values()})

    def to_anthropic_format(
        self,
        categories: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Convert all tools to Anthropic API format.

        Args:
            categories: Optional list of categories to include.
                        If None, includes all tools.

        Returns:
            List of tool definitions in Anthropic format.
        """
        tools = self.get_all_tools()
        if categories:
            tools = [t for t in tools if t.category in categories]
        return [t.to_anthropic_format() for t in tools]

    def to_openai_format(
        self,
        categories: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Convert all tools to OpenAI API format.

        Args:
            categories: Optional list of categories to include.
                        If None, includes all tools.

        Returns:
            List of tool definitions in OpenAI format.
        """
        tools = self.get_all_tools()
        if categories:
            tools = [t for t in tools if t.category in categories]
        return [t.to_openai_format() for t in tools]

    def clear(self) -> None:
        """Remove all registered tools.

        Primarily used for testing.
        """
        self._tools.clear()
        logger.debug("Tool registry cleared")

    def __len__(self) -> int:
        """Return number of registered tools."""
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        """Check if a tool is registered."""
        return name in self._tools


def get_registry() -> ToolRegistry:
    """Get the global tool registry instance.

    Returns:
        The singleton ToolRegistry instance.
    """
    return ToolRegistry()
