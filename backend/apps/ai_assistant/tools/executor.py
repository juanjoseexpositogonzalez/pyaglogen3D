"""Tool execution engine.

Provides the ToolExecutor class that handles tool invocation,
validation, context injection, and error handling.
"""

import inspect
import logging
from typing import Any

from .base import ToolDefinition, ToolResult
from .context import ContextManager, ToolContext
from .registry import ToolRegistry
from .validation import ValidationError, validate_and_raise

logger = logging.getLogger(__name__)


class ToolExecutionError(Exception):
    """Raised when tool execution fails."""

    def __init__(
        self,
        message: str,
        error_type: str = "ExecutionError",
        recoverable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.error_type = error_type
        self.recoverable = recoverable
        self.details = details


class ToolExecutor:
    """Executes tools with validation and context injection.

    Handles the complete lifecycle of tool execution:
    1. Validate tool exists
    2. Validate arguments against schema
    3. Inject context (user, project_id)
    4. Execute handler
    5. Wrap result in ToolResult

    Example:
        executor = ToolExecutor(registry, context)
        result = executor.execute("list_algorithms", {})
    """

    def __init__(
        self,
        registry: ToolRegistry,
        context: ToolContext,
    ) -> None:
        """Initialize the executor.

        Args:
            registry: The tool registry to use.
            context: The execution context.
        """
        self.registry = registry
        self.context = context

    def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        """Execute a tool synchronously.

        Args:
            tool_name: Name of the tool to execute.
            arguments: Arguments to pass to the tool.

        Returns:
            ToolResult containing success/failure and data/error.
        """
        logger.info(
            f"Executing tool: {tool_name}",
            extra={
                "tool_name": tool_name,
                "request_id": self.context.request_id,
                "user_id": self.context.user.id if self.context.user else None,
            },
        )

        try:
            # Get the tool definition
            tool = self.registry.get_tool(tool_name)
            if tool is None:
                return ToolResult.error_result(
                    error_type="ToolNotFoundError",
                    message=f"Tool '{tool_name}' not found",
                    recoverable=False,
                )

            # Check project requirement
            if tool.requires_project and self.context.project_id is None:
                return ToolResult.error_result(
                    error_type="ContextError",
                    message=f"Tool '{tool_name}' requires a project context",
                    recoverable=True,
                )

            # Validate arguments
            try:
                validate_and_raise(tool.parameters, arguments)
            except ValidationError as e:
                return ToolResult.error_result(
                    error_type="ValidationError",
                    message=e.message,
                    details={"errors": e.errors},
                    recoverable=True,
                )

            # Inject context
            merged_args = ContextManager.inject_context(
                self.context,
                arguments,
                tool._injected_params,
            )

            # Filter arguments to only those accepted by the handler
            handler_args = self._filter_handler_args(tool, merged_args)

            # Execute the handler
            result = tool.handler(**handler_args)

            # Wrap in ToolResult
            if isinstance(result, ToolResult):
                return result
            if isinstance(result, dict):
                return ToolResult.success_result(result)

            return ToolResult.success_result({"result": result})

        except ToolExecutionError as e:
            logger.warning(
                f"Tool execution error: {tool_name} - {e.message}",
                extra={
                    "tool_name": tool_name,
                    "error_type": e.error_type,
                    "request_id": self.context.request_id,
                },
            )
            return ToolResult.error_result(
                error_type=e.error_type,
                message=e.message,
                details=e.details,
                recoverable=e.recoverable,
            )
        except PermissionError as e:
            logger.warning(
                f"Permission denied for tool: {tool_name}",
                extra={
                    "tool_name": tool_name,
                    "request_id": self.context.request_id,
                },
            )
            return ToolResult.error_result(
                error_type="PermissionError",
                message=str(e) or "Permission denied",
                recoverable=False,
            )
        except ValueError as e:
            logger.warning(
                f"Value error in tool: {tool_name} - {e}",
                extra={
                    "tool_name": tool_name,
                    "request_id": self.context.request_id,
                },
            )
            return ToolResult.error_result(
                error_type="ValueError",
                message=str(e),
                recoverable=True,
            )
        except Exception as e:
            logger.exception(
                f"Unexpected error executing tool: {tool_name}",
                extra={
                    "tool_name": tool_name,
                    "request_id": self.context.request_id,
                },
            )
            return ToolResult.error_result(
                error_type="InternalError",
                message="An unexpected error occurred",
                recoverable=False,
            )

    def _filter_handler_args(
        self,
        tool: ToolDefinition,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        """Filter arguments to only those accepted by the handler.

        Args:
            tool: The tool definition.
            args: All available arguments.

        Returns:
            Dictionary of arguments accepted by the handler.
        """
        sig = inspect.signature(tool.handler)
        handler_params = set(sig.parameters.keys())

        # Check if handler accepts **kwargs
        accepts_kwargs = any(
            p.kind == inspect.Parameter.VAR_KEYWORD
            for p in sig.parameters.values()
        )

        if accepts_kwargs:
            return args

        return {k: v for k, v in args.items() if k in handler_params}

    def execute_async(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        """Queue a tool for asynchronous execution.

        For tools marked as is_async=True, this queues a Celery task
        and returns the task ID immediately.

        Args:
            tool_name: Name of the tool to execute.
            arguments: Arguments to pass to the tool.

        Returns:
            ToolResult containing task_id for status tracking.
        """
        tool = self.registry.get_tool(tool_name)
        if tool is None:
            return ToolResult.error_result(
                error_type="ToolNotFoundError",
                message=f"Tool '{tool_name}' not found",
                recoverable=False,
            )

        if not tool.is_async:
            # For non-async tools, just execute synchronously
            return self.execute(tool_name, arguments)

        # TODO: Implement Celery task queuing
        # For now, we execute synchronously with a flag
        logger.info(
            f"Async tool execution requested: {tool_name}",
            extra={
                "tool_name": tool_name,
                "request_id": self.context.request_id,
            },
        )

        # Execute synchronously for now, returning task info format
        result = self.execute(tool_name, arguments)
        if result.success:
            # Wrap in async-style response
            return ToolResult.success_result({
                "status": "completed",
                "task_id": f"sync-{self.context.request_id}",
                "result": result.data,
            })
        return result
