"""Tool decorator for easy tool definition.

Provides the @tool decorator that automatically creates ToolDefinition
instances from annotated Python functions.
"""

import inspect
import re
from collections.abc import Callable
from typing import Any, get_type_hints

from .base import ToolDefinition

# Type mapping from Python types to JSON Schema types
TYPE_MAP: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
}


def _python_type_to_json_schema(python_type: type) -> dict[str, Any]:
    """Convert a Python type to JSON Schema type.

    Args:
        python_type: The Python type to convert.

    Returns:
        JSON Schema type definition.
    """
    # Handle None/NoneType
    if python_type is type(None):
        return {"type": "null"}

    # Handle basic types
    if python_type in TYPE_MAP:
        return {"type": TYPE_MAP[python_type]}

    # Handle Optional types (Union[X, None])
    origin = getattr(python_type, "__origin__", None)
    if origin is not None:
        args = getattr(python_type, "__args__", ())

        # Handle Union types
        if str(origin) in ("typing.Union", "types.UnionType"):
            # Check if it's Optional (Union with None)
            non_none_types = [a for a in args if a is not type(None)]
            if len(non_none_types) == 1 and type(None) in args:
                # This is Optional[X]
                inner_schema = _python_type_to_json_schema(non_none_types[0])
                return inner_schema  # Optional params shouldn't be required

            # Multiple non-None types - use anyOf
            return {"anyOf": [_python_type_to_json_schema(a) for a in args]}

        # Handle List[X]
        if origin is list:
            if args:
                return {
                    "type": "array",
                    "items": _python_type_to_json_schema(args[0]),
                }
            return {"type": "array"}

        # Handle Dict[K, V]
        if origin is dict:
            return {"type": "object"}

    # Default to string for unknown types
    return {"type": "string"}


def _parse_docstring(func: Callable[..., Any]) -> dict[str, str]:
    """Parse Google-style docstring to extract parameter descriptions.

    Args:
        func: The function to parse.

    Returns:
        Dictionary mapping parameter names to their descriptions.
    """
    descriptions: dict[str, str] = {}
    docstring = func.__doc__

    if not docstring:
        return descriptions

    # Find the Args section
    args_match = re.search(
        r"Args?:\s*\n((?:\s+\w+.*\n?)+)",
        docstring,
        re.IGNORECASE,
    )
    if not args_match:
        return descriptions

    args_section = args_match.group(1)

    # Parse each argument
    # Pattern: parameter_name (optional type): description
    pattern = r"^\s+(\w+)(?:\s*\([^)]*\))?:\s*(.+?)(?=\n\s+\w+|\n\n|\Z)"
    for match in re.finditer(pattern, args_section, re.MULTILINE | re.DOTALL):
        param_name = match.group(1)
        description = match.group(2).strip()
        # Clean up multi-line descriptions
        description = re.sub(r"\s+", " ", description)
        descriptions[param_name] = description

    return descriptions


def _build_parameter_schema(
    func: Callable[..., Any],
    exclude_params: set[str] | None = None,
) -> dict[str, Any]:
    """Build JSON Schema for function parameters.

    Args:
        func: The function to analyze.
        exclude_params: Parameter names to exclude from the schema.

    Returns:
        JSON Schema for the function parameters.
    """
    if exclude_params is None:
        exclude_params = {"user", "project_id", "kwargs", "args"}

    # Get type hints and parameter descriptions
    try:
        type_hints = get_type_hints(func)
    except Exception:
        type_hints = {}

    param_descriptions = _parse_docstring(func)
    sig = inspect.signature(func)

    properties: dict[str, Any] = {}
    required: list[str] = []

    for param_name, param in sig.parameters.items():
        # Skip excluded parameters
        if param_name in exclude_params:
            continue

        # Skip *args and **kwargs
        if param.kind in (
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        ):
            continue

        # Get type info
        param_type = type_hints.get(param_name, str)
        schema = _python_type_to_json_schema(param_type)

        # Add description if available
        if param_name in param_descriptions:
            schema["description"] = param_descriptions[param_name]

        properties[param_name] = schema

        # Add to required if no default value
        if param.default is inspect.Parameter.empty:
            # Check if it's an Optional type
            origin = getattr(param_type, "__origin__", None)
            if str(origin) not in ("typing.Union", "types.UnionType"):
                required.append(param_name)
            elif type(None) not in getattr(param_type, "__args__", ()):
                required.append(param_name)

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def tool(
    name: str | None = None,
    description: str | None = None,
    category: str = "utility",
    requires_project: bool = False,
    is_async: bool = False,
) -> Callable[[Callable[..., dict[str, Any]]], ToolDefinition]:
    """Decorator to create a ToolDefinition from a function.

    The decorator extracts parameter information from type hints and docstrings
    to automatically build the JSON Schema for the tool.

    Args:
        name: Tool name (defaults to function name).
        description: Tool description (defaults to function docstring).
        category: Tool category for grouping.
        requires_project: Whether the tool requires project context.
        is_async: Whether the tool runs asynchronously.

    Returns:
        A decorator that creates a ToolDefinition.

    Example:
        @tool(
            name="list_algorithms",
            description="List all available simulation algorithms",
            category="utility"
        )
        def list_algorithms_handler(user: User) -> dict:
            '''List available algorithms.

            Args:
                user: The authenticated user.

            Returns:
                Dictionary containing available algorithms.
            '''
            return {"algorithms": ["DLA", "CCA", "BALLISTIC", "EDEN"]}
    """

    def decorator(func: Callable[..., dict[str, Any]]) -> ToolDefinition:
        # Determine tool name and description
        tool_name = name or func.__name__
        tool_description = description
        if not tool_description:
            # Use first line of docstring
            doc = func.__doc__
            if doc:
                tool_description = doc.split("\n")[0].strip()
            else:
                tool_description = f"Execute {tool_name}"

        # Build parameter schema
        parameters = _build_parameter_schema(func)

        return ToolDefinition(
            name=tool_name,
            description=tool_description,
            parameters=parameters,
            handler=func,
            category=category,
            requires_project=requires_project,
            is_async=is_async,
        )

    return decorator
