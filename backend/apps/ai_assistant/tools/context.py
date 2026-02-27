"""Tool execution context management.

Provides context objects that carry user, project, and request information
to tool handlers.
"""

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from django.contrib.auth import get_user_model
    from django.http import HttpRequest

    User = get_user_model()


@dataclass
class ToolContext:
    """Context information for tool execution.

    Contains all contextual information needed by tools,
    injected automatically by the executor.

    Attributes:
        user: The authenticated user making the request.
        project_id: The current project ID (if any).
        conversation_id: The current chat conversation ID (if any).
        request_id: Unique ID for request tracing.
    """

    user: Any  # User model instance
    project_id: int | None = None
    conversation_id: int | None = None
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for logging/debugging."""
        return {
            "user_id": self.user.id if self.user else None,
            "project_id": self.project_id,
            "conversation_id": self.conversation_id,
            "request_id": self.request_id,
        }


class ContextManager:
    """Manages tool execution context creation and injection."""

    @staticmethod
    def from_request(
        request: "HttpRequest",
        project_id: int | None = None,
        conversation_id: int | None = None,
    ) -> ToolContext:
        """Create a ToolContext from an HTTP request.

        Args:
            request: The Django HTTP request.
            project_id: Optional project ID override.
            conversation_id: Optional conversation ID.

        Returns:
            A new ToolContext instance.
        """
        # Try to get project_id from request data if not provided
        if project_id is None:
            project_id = getattr(request, "data", {}).get("project_id")
            if project_id is None:
                project_id = request.GET.get("project_id")
            if project_id is not None:
                try:
                    project_id = int(project_id)
                except (ValueError, TypeError):
                    project_id = None

        return ToolContext(
            user=request.user,
            project_id=project_id,
            conversation_id=conversation_id,
            request_id=str(uuid.uuid4()),
        )

    @staticmethod
    def inject_context(
        context: ToolContext,
        arguments: dict[str, Any],
        injected_params: set[str] | None = None,
    ) -> dict[str, Any]:
        """Inject context values into tool arguments.

        Merges context information (user, project_id) with the
        LLM-provided arguments for tool execution.

        Args:
            context: The execution context.
            arguments: LLM-provided arguments.
            injected_params: Set of parameter names to inject.
                            Defaults to {"user", "project_id"}.

        Returns:
            Merged arguments dictionary.
        """
        if injected_params is None:
            injected_params = {"user", "project_id"}

        merged = dict(arguments)

        if "user" in injected_params:
            merged["user"] = context.user

        if "project_id" in injected_params and context.project_id is not None:
            merged["project_id"] = context.project_id

        if "conversation_id" in injected_params and context.conversation_id is not None:
            merged["conversation_id"] = context.conversation_id

        if "request_id" in injected_params:
            merged["request_id"] = context.request_id

        return merged
