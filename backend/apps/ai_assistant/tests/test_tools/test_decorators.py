"""Tests for tool decorators."""

import pytest

from apps.ai_assistant.tools.base import ToolDefinition
from apps.ai_assistant.tools.decorators import (
    _build_parameter_schema,
    _parse_docstring,
    _python_type_to_json_schema,
    tool,
)


class TestPythonTypeToJsonSchema:
    """Tests for type conversion."""

    def test_string_type(self):
        """Test string type conversion."""
        result = _python_type_to_json_schema(str)
        assert result == {"type": "string"}

    def test_int_type(self):
        """Test integer type conversion."""
        result = _python_type_to_json_schema(int)
        assert result == {"type": "integer"}

    def test_float_type(self):
        """Test float type conversion."""
        result = _python_type_to_json_schema(float)
        assert result == {"type": "number"}

    def test_bool_type(self):
        """Test boolean type conversion."""
        result = _python_type_to_json_schema(bool)
        assert result == {"type": "boolean"}

    def test_list_type(self):
        """Test list type conversion."""
        result = _python_type_to_json_schema(list)
        assert result == {"type": "array"}

    def test_dict_type(self):
        """Test dict type conversion."""
        result = _python_type_to_json_schema(dict)
        assert result == {"type": "object"}

    def test_list_with_item_type(self):
        """Test list[str] type conversion."""
        result = _python_type_to_json_schema(list[str])
        assert result == {"type": "array", "items": {"type": "string"}}

    def test_optional_type(self):
        """Test Optional[str] type conversion."""
        # Using Union syntax for Optional
        from typing import Optional
        result = _python_type_to_json_schema(Optional[str])
        # Optional should return the inner type schema
        assert result == {"type": "string"}

    def test_unknown_type_defaults_to_string(self):
        """Test that unknown types default to string."""

        class CustomClass:
            pass

        result = _python_type_to_json_schema(CustomClass)
        assert result == {"type": "string"}


class TestParseDocstring:
    """Tests for docstring parsing."""

    def test_parse_google_style_docstring(self):
        """Test parsing Google-style docstring."""

        def func():
            """Do something.

            Args:
                name: The user's name.
                count: Number of items.
            """
            pass

        result = _parse_docstring(func)
        assert "name" in result
        assert result["name"] == "The user's name."
        assert "count" in result
        assert result["count"] == "Number of items."

    def test_parse_multiline_description(self):
        """Test parsing multiline parameter description."""

        def func():
            """Do something.

            Args:
                long_param: This is a very long description
                    that spans multiple lines.
            """
            pass

        result = _parse_docstring(func)
        assert "long_param" in result
        assert "very long description" in result["long_param"]

    def test_no_docstring(self):
        """Test function without docstring."""

        def func():
            pass

        result = _parse_docstring(func)
        assert result == {}

    def test_no_args_section(self):
        """Test docstring without Args section."""

        def func():
            """Do something."""
            pass

        result = _parse_docstring(func)
        assert result == {}


class TestBuildParameterSchema:
    """Tests for parameter schema building."""

    def test_simple_parameters(self):
        """Test building schema from simple parameters."""

        def func(name: str, count: int):
            pass

        schema = _build_parameter_schema(func)

        assert schema["type"] == "object"
        assert "name" in schema["properties"]
        assert schema["properties"]["name"]["type"] == "string"
        assert "count" in schema["properties"]
        assert schema["properties"]["count"]["type"] == "integer"
        assert "name" in schema["required"]
        assert "count" in schema["required"]

    def test_optional_parameters(self):
        """Test that optional parameters are not required."""

        def func(name: str, count: int = 10):
            pass

        schema = _build_parameter_schema(func)

        assert "name" in schema["required"]
        assert "count" not in schema["required"]

    def test_excludes_user_parameter(self):
        """Test that 'user' parameter is excluded."""

        def func(name: str, user=None):
            pass

        schema = _build_parameter_schema(func)

        assert "name" in schema["properties"]
        assert "user" not in schema["properties"]

    def test_excludes_kwargs(self):
        """Test that **kwargs is excluded."""

        def func(name: str, **kwargs):
            pass

        schema = _build_parameter_schema(func)

        assert "name" in schema["properties"]
        assert "kwargs" not in schema["properties"]


class TestToolDecorator:
    """Tests for @tool decorator."""

    def test_basic_tool_creation(self):
        """Test creating a basic tool with decorator."""

        @tool(
            name="test_tool",
            description="A test tool",
            category="test",
        )
        def test_handler(message: str, user=None) -> dict:
            """Handle test message.

            Args:
                message: The message to process.
                user: The authenticated user.
            """
            return {"result": message}

        assert isinstance(test_handler, ToolDefinition)
        assert test_handler.name == "test_tool"
        assert test_handler.description == "A test tool"
        assert test_handler.category == "test"
        assert test_handler.requires_project is False
        assert test_handler.is_async is False

    def test_tool_with_project_requirement(self):
        """Test creating a tool that requires project context."""

        @tool(
            name="project_tool",
            description="Needs project",
            requires_project=True,
        )
        def project_handler(action: str, user=None, project_id=None) -> dict:
            return {}

        assert project_handler.requires_project is True

    def test_tool_with_async_flag(self):
        """Test creating an async tool."""

        @tool(
            name="async_tool",
            description="Runs async",
            is_async=True,
        )
        def async_handler(data: dict, user=None) -> dict:
            return {}

        assert async_handler.is_async is True

    def test_tool_name_from_function(self):
        """Test that tool name defaults to function name."""

        @tool(description="Test")
        def my_function(x: int) -> dict:
            return {}

        assert my_function.name == "my_function"

    def test_tool_description_from_docstring(self):
        """Test that description comes from docstring if not provided."""

        @tool()
        def documented_function(x: int) -> dict:
            """This is the first line of docstring."""
            return {}

        assert documented_function.description == "This is the first line of docstring."

    def test_tool_parameters_extracted(self):
        """Test that parameters are extracted from type hints."""

        @tool(name="params_tool", description="Test params")
        def handler(
            name: str,
            count: int,
            enabled: bool = True,
            user=None,
        ) -> dict:
            """Handler with params.

            Args:
                name: The name parameter.
                count: The count parameter.
                enabled: Whether to enable.
                user: The user.
            """
            return {}

        schema = handler.parameters
        assert schema["type"] == "object"
        assert "name" in schema["properties"]
        assert "count" in schema["properties"]
        assert "enabled" in schema["properties"]
        assert "user" not in schema["properties"]

        # Check descriptions from docstring
        assert schema["properties"]["name"].get("description") == "The name parameter."

        # Check required fields
        assert "name" in schema["required"]
        assert "count" in schema["required"]
        assert "enabled" not in schema["required"]  # Has default

    def test_tool_handler_callable(self):
        """Test that tool handler is callable and works."""

        @tool(name="callable_tool", description="Test")
        def handler(value: int, user=None) -> dict:
            return {"doubled": value * 2}

        # The decorator returns ToolDefinition, handler is stored
        result = handler.handler(value=5)
        assert result == {"doubled": 10}
