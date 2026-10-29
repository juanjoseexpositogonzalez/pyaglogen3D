"""Tests for the tool registry."""

import pytest

from apps.ai_assistant.tools.base import ToolDefinition, ToolResult
from apps.ai_assistant.tools.registry import ToolRegistry, get_registry


@pytest.fixture
def fresh_registry():
    """Get a fresh registry and clear it after test."""
    registry = get_registry()
    registry.clear()
    yield registry
    registry.clear()


@pytest.fixture
def sample_tool():
    """Create a sample tool definition."""
    def handler(message: str, user=None) -> dict:
        return {"echo": message}

    return ToolDefinition(
        name="test_tool",
        description="A test tool",
        parameters={
            "type": "object",
            "properties": {
                "message": {"type": "string"},
            },
            "required": ["message"],
        },
        handler=handler,
        category="test",
    )


@pytest.fixture
def analysis_tool():
    """Create an analysis category tool."""
    def handler(data: list, user=None) -> dict:
        return {"count": len(data)}

    return ToolDefinition(
        name="analyze_data",
        description="Analyze data",
        parameters={
            "type": "object",
            "properties": {
                "data": {"type": "array"},
            },
            "required": ["data"],
        },
        handler=handler,
        category="analysis",
    )


class TestToolRegistry:
    """Tests for ToolRegistry class."""

    def test_registry_is_singleton(self):
        """Test that registry is a singleton."""
        registry1 = get_registry()
        registry2 = get_registry()
        assert registry1 is registry2

    def test_register_tool(self, fresh_registry, sample_tool):
        """Test registering a tool."""
        fresh_registry.register(sample_tool)
        assert len(fresh_registry) == 1
        assert "test_tool" in fresh_registry

    def test_get_tool(self, fresh_registry, sample_tool):
        """Test retrieving a tool by name."""
        fresh_registry.register(sample_tool)
        tool = fresh_registry.get_tool("test_tool")
        assert tool is not None
        assert tool.name == "test_tool"

    def test_get_nonexistent_tool(self, fresh_registry):
        """Test retrieving a tool that doesn't exist."""
        tool = fresh_registry.get_tool("nonexistent")
        assert tool is None

    def test_get_all_tools(self, fresh_registry, sample_tool, analysis_tool):
        """Test getting all registered tools."""
        fresh_registry.register(sample_tool)
        fresh_registry.register(analysis_tool)
        tools = fresh_registry.get_all_tools()
        assert len(tools) == 2

    def test_get_tools_by_category(self, fresh_registry, sample_tool, analysis_tool):
        """Test filtering tools by category."""
        fresh_registry.register(sample_tool)
        fresh_registry.register(analysis_tool)

        test_tools = fresh_registry.get_tools_by_category("test")
        assert len(test_tools) == 1
        assert test_tools[0].name == "test_tool"

        analysis_tools = fresh_registry.get_tools_by_category("analysis")
        assert len(analysis_tools) == 1
        assert analysis_tools[0].name == "analyze_data"

    def test_get_categories(self, fresh_registry, sample_tool, analysis_tool):
        """Test getting all categories."""
        fresh_registry.register(sample_tool)
        fresh_registry.register(analysis_tool)

        categories = fresh_registry.get_categories()
        assert "test" in categories
        assert "analysis" in categories
        assert len(categories) == 2

    def test_unregister_tool(self, fresh_registry, sample_tool):
        """Test removing a tool."""
        fresh_registry.register(sample_tool)
        assert len(fresh_registry) == 1

        result = fresh_registry.unregister("test_tool")
        assert result is True
        assert len(fresh_registry) == 0

    def test_unregister_nonexistent_tool(self, fresh_registry):
        """Test removing a tool that doesn't exist."""
        result = fresh_registry.unregister("nonexistent")
        assert result is False

    def test_duplicate_registration_overwrites(self, fresh_registry, sample_tool):
        """Test that registering the same tool twice overwrites."""
        fresh_registry.register(sample_tool)

        # Create a modified version
        def new_handler(message: str, user=None) -> dict:
            return {"new_echo": message}

        modified_tool = ToolDefinition(
            name="test_tool",  # Same name
            description="Modified tool",
            parameters=sample_tool.parameters,
            handler=new_handler,
            category="test",
        )
        fresh_registry.register(modified_tool)

        assert len(fresh_registry) == 1
        tool = fresh_registry.get_tool("test_tool")
        assert tool.description == "Modified tool"

    def test_clear_registry(self, fresh_registry, sample_tool, analysis_tool):
        """Test clearing all tools."""
        fresh_registry.register(sample_tool)
        fresh_registry.register(analysis_tool)
        assert len(fresh_registry) == 2

        fresh_registry.clear()
        assert len(fresh_registry) == 0


class TestToolFormats:
    """Tests for tool format conversion."""

    def test_to_anthropic_format(self, fresh_registry, sample_tool):
        """Test conversion to Anthropic format."""
        fresh_registry.register(sample_tool)
        tools = fresh_registry.to_anthropic_format()

        assert len(tools) == 1
        tool = tools[0]
        assert tool["name"] == "test_tool"
        assert tool["description"] == "A test tool"
        assert "input_schema" in tool
        assert tool["input_schema"]["type"] == "object"

    def test_to_openai_format(self, fresh_registry, sample_tool):
        """Test conversion to OpenAI format."""
        fresh_registry.register(sample_tool)
        tools = fresh_registry.to_openai_format()

        assert len(tools) == 1
        tool = tools[0]
        assert tool["type"] == "function"
        assert "function" in tool
        assert tool["function"]["name"] == "test_tool"
        assert tool["function"]["description"] == "A test tool"
        assert "parameters" in tool["function"]

    def test_format_with_category_filter(self, fresh_registry, sample_tool, analysis_tool):
        """Test format conversion with category filter."""
        fresh_registry.register(sample_tool)
        fresh_registry.register(analysis_tool)

        anthropic_tools = fresh_registry.to_anthropic_format(categories=["test"])
        assert len(anthropic_tools) == 1
        assert anthropic_tools[0]["name"] == "test_tool"

        openai_tools = fresh_registry.to_openai_format(categories=["analysis"])
        assert len(openai_tools) == 1
        assert openai_tools[0]["function"]["name"] == "analyze_data"
