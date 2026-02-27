"""Base classes for AI Assistant tools.

Defines the core dataclasses used throughout the tool system:
- ToolDefinition: Describes a tool and its parameters
- ToolResult: Wraps successful execution results
- ToolError: Wraps error information
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolError:
    """Represents an error that occurred during tool execution.

    Attributes:
        error_type: Category of error (ValidationError, PermissionError, etc.)
        message: User-friendly error message
        details: Additional context for debugging
        recoverable: Whether the user can retry with different parameters
    """

    error_type: str
    message: str
    details: dict[str, Any] | None = None
    recoverable: bool = True

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result: dict[str, Any] = {
            "error_type": self.error_type,
            "message": self.message,
            "recoverable": self.recoverable,
        }
        if self.details:
            result["details"] = self.details
        return result


@dataclass
class ToolResult:
    """Represents the result of a tool execution.

    Attributes:
        success: Whether the execution was successful
        data: The result data if successful
        error: Error information if unsuccessful
    """

    success: bool
    data: dict[str, Any] | None = None
    error: ToolError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        if self.success:
            return {
                "success": True,
                "data": self.data or {},
            }
        return {
            "success": False,
            "error": self.error.to_dict() if self.error else None,
        }

    @classmethod
    def success_result(cls, data: dict[str, Any]) -> "ToolResult":
        """Create a successful result."""
        return cls(success=True, data=data)

    @classmethod
    def error_result(
        cls,
        error_type: str,
        message: str,
        details: dict[str, Any] | None = None,
        recoverable: bool = True,
    ) -> "ToolResult":
        """Create an error result."""
        return cls(
            success=False,
            error=ToolError(
                error_type=error_type,
                message=message,
                details=details,
                recoverable=recoverable,
            ),
        )


@dataclass
class ToolDefinition:
    """Defines a tool that can be used by the AI assistant.

    Attributes:
        name: Unique identifier for the tool (e.g., "run_dla_simulation")
        description: Human-readable description of what the tool does
        parameters: JSON Schema defining the tool's parameters
        handler: The callable that executes the tool
        category: Grouping category (simulation, analysis, export, utility)
        requires_project: Whether the tool requires a project context
        is_async: Whether the tool runs as a Celery task
    """

    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., dict[str, Any]]
    category: str = "utility"
    requires_project: bool = False
    is_async: bool = False
    _injected_params: set[str] = field(default_factory=lambda: {"user", "project_id"})

    def to_anthropic_format(self) -> dict[str, Any]:
        """Convert to Anthropic tool format.

        Returns:
            Dictionary in Anthropic's tool_use format.
        """
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        }

    def to_openai_format(self) -> dict[str, Any]:
        """Convert to OpenAI function calling format.

        Returns:
            Dictionary in OpenAI's function format.
        """
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "category": self.category,
            "requires_project": self.requires_project,
            "is_async": self.is_async,
        }
