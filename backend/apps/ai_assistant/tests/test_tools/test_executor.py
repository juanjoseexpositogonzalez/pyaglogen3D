"""Tests for tool executor."""

import pytest
from unittest.mock import MagicMock

from apps.ai_assistant.tools.base import ToolDefinition, ToolResult
from apps.ai_assistant.tools.context import ToolContext
from apps.ai_assistant.tools.executor import ToolExecutor, ToolExecutionError
from apps.ai_assistant.tools.registry import ToolRegistry, get_registry


@pytest.fixture
def mock_user():
    """Create a mock user."""
    user = MagicMock()
    user.id = 1
    user.username = "testuser"
    return user


@pytest.fixture
def context(mock_user):
    """Create a test context."""
    return ToolContext(
        user=mock_user,
        project_id=None,
        conversation_id=None,
    )


@pytest.fixture
def fresh_registry():
    """Get a fresh registry and clear it after test."""
    registry = get_registry()
    registry.clear()
    yield registry
    registry.clear()


@pytest.fixture
def echo_tool():
    """Create a simple echo tool."""
    def handler(message: str, user=None) -> dict:
        return {"echo": message, "user_id": user.id if user else None}

    return ToolDefinition(
        name="echo",
        description="Echo a message",
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
def project_tool():
    """Create a tool that requires project context."""
    def handler(action: str, user=None, project_id=None) -> dict:
        return {"action": action, "project_id": project_id}

    return ToolDefinition(
        name="project_action",
        description="Do something with a project",
        parameters={
            "type": "object",
            "properties": {
                "action": {"type": "string"},
            },
            "required": ["action"],
        },
        handler=handler,
        category="test",
        requires_project=True,
    )


@pytest.fixture
def error_tool():
    """Create a tool that raises an error."""
    def handler(should_fail: bool, user=None) -> dict:
        if should_fail:
            raise ValueError("Intentional error")
        return {"success": True}

    return ToolDefinition(
        name="error_tool",
        description="Tool that can fail",
        parameters={
            "type": "object",
            "properties": {
                "should_fail": {"type": "boolean"},
            },
            "required": ["should_fail"],
        },
        handler=handler,
        category="test",
    )


class TestToolExecutor:
    """Tests for ToolExecutor class."""

    def test_execute_success(self, fresh_registry, echo_tool, context):
        """Test successful tool execution."""
        fresh_registry.register(echo_tool)
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("echo", {"message": "hello"})

        assert result.success is True
        assert result.data["echo"] == "hello"
        assert result.data["user_id"] == context.user.id

    def test_execute_tool_not_found(self, fresh_registry, context):
        """Test execution of non-existent tool."""
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("nonexistent", {})

        assert result.success is False
        assert result.error.error_type == "ToolNotFoundError"

    def test_execute_validation_error(self, fresh_registry, echo_tool, context):
        """Test execution with invalid arguments."""
        fresh_registry.register(echo_tool)
        executor = ToolExecutor(fresh_registry, context)

        # Missing required field
        result = executor.execute("echo", {})

        assert result.success is False
        assert result.error.error_type == "ValidationError"
        assert "message" in result.error.message

    def test_execute_wrong_type(self, fresh_registry, echo_tool, context):
        """Test execution with wrong argument type."""
        fresh_registry.register(echo_tool)
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("echo", {"message": 123})

        assert result.success is False
        assert result.error.error_type == "ValidationError"

    def test_execute_requires_project_without_context(
        self, fresh_registry, project_tool, context
    ):
        """Test execution of project-required tool without project."""
        fresh_registry.register(project_tool)
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("project_action", {"action": "do"})

        assert result.success is False
        assert result.error.error_type == "ContextError"
        assert "project" in result.error.message.lower()

    def test_execute_requires_project_with_context(
        self, fresh_registry, project_tool, mock_user
    ):
        """Test execution of project-required tool with project context."""
        fresh_registry.register(project_tool)

        context = ToolContext(
            user=mock_user,
            project_id=42,
        )
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("project_action", {"action": "do"})

        assert result.success is True
        assert result.data["project_id"] == 42

    def test_execute_handler_value_error(self, fresh_registry, error_tool, context):
        """Test execution when handler raises ValueError."""
        fresh_registry.register(error_tool)
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("error_tool", {"should_fail": True})

        assert result.success is False
        assert result.error.error_type == "ValueError"
        assert "Intentional error" in result.error.message

    def test_execute_handler_success_after_potential_error(
        self, fresh_registry, error_tool, context
    ):
        """Test execution when handler succeeds."""
        fresh_registry.register(error_tool)
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("error_tool", {"should_fail": False})

        assert result.success is True
        assert result.data["success"] is True


class TestContextInjection:
    """Tests for context injection in tool execution."""

    def test_user_injected(self, fresh_registry, echo_tool, context):
        """Test that user is injected into handler."""
        fresh_registry.register(echo_tool)
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("echo", {"message": "test"})

        assert result.success is True
        assert result.data["user_id"] == context.user.id

    def test_project_id_injected(self, fresh_registry, project_tool, mock_user):
        """Test that project_id is injected when present."""
        fresh_registry.register(project_tool)

        context = ToolContext(user=mock_user, project_id=123)
        executor = ToolExecutor(fresh_registry, context)

        result = executor.execute("project_action", {"action": "test"})

        assert result.success is True
        assert result.data["project_id"] == 123


class TestToolResult:
    """Tests for ToolResult dataclass."""

    def test_success_result(self):
        """Test creating a success result."""
        result = ToolResult.success_result({"value": 42})

        assert result.success is True
        assert result.data == {"value": 42}
        assert result.error is None

    def test_error_result(self):
        """Test creating an error result."""
        result = ToolResult.error_result(
            error_type="TestError",
            message="Something went wrong",
            details={"code": 123},
            recoverable=False,
        )

        assert result.success is False
        assert result.data is None
        assert result.error.error_type == "TestError"
        assert result.error.message == "Something went wrong"
        assert result.error.details == {"code": 123}
        assert result.error.recoverable is False

    def test_to_dict_success(self):
        """Test converting success result to dict."""
        result = ToolResult.success_result({"value": 42})
        d = result.to_dict()

        assert d["success"] is True
        assert d["data"] == {"value": 42}

    def test_to_dict_error(self):
        """Test converting error result to dict."""
        result = ToolResult.error_result("TestError", "Failed")
        d = result.to_dict()

        assert d["success"] is False
        assert d["error"]["error_type"] == "TestError"
        assert d["error"]["message"] == "Failed"
