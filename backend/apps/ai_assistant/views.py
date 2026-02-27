"""AI Assistant views."""
import logging

import anthropic
import openai
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AIProviderConfig
from .permissions import IsAIUser
from .serializers import AIProviderConfigListSerializer, AIProviderConfigSerializer
from .services.encryption import get_encryption_service
from .services.providers import ProviderFactory, StopReason
from .tools.context import ContextManager
from .tools.executor import ToolExecutor
from .tools.registry import get_registry

logger = logging.getLogger(__name__)


class AIProviderConfigViewSet(viewsets.ModelViewSet):
    """ViewSet for managing AI provider configurations."""

    permission_classes = [IsAuthenticated, IsAIUser]

    def get_serializer_class(self):
        """Use list serializer for list action."""
        if self.action == "list":
            return AIProviderConfigListSerializer
        return AIProviderConfigSerializer

    def get_queryset(self):
        """Return only configs for the current user."""
        return AIProviderConfig.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        """Set the user on creation."""
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"])
    def test_connection(self, request: Request, pk=None) -> Response:
        """Test the API key connection for a specific provider.

        Tests the connection by making a simple API call to verify
        the API key is valid and the provider is accessible.

        Returns:
            200 with success message if connection works.
            400 with error message if connection fails.

        Note:
            API keys are never logged or exposed in error messages.
        """
        config = self.get_object()

        try:
            # Decrypt API key and create provider
            encryption = get_encryption_service()
            api_key = encryption.decrypt(config.api_key_encrypted)
            provider = ProviderFactory.create_from_config(config, api_key)

            # Test with a simple request
            response = provider.complete(
                messages=[{"role": "user", "content": "Say 'connected' in one word."}],
                max_tokens=10,
                temperature=0,
            )

            if response.stop_reason == StopReason.ERROR:
                # Sanitize error message - don't expose internal details
                error_msg = self._sanitize_error_message(response.text)
                return Response(
                    {"success": False, "message": error_msg},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            return Response({
                "success": True,
                "message": f"Connected to {config.get_provider_display()} ({config.model_name})",
                "response": response.text[:100] if response.text else "",
            })

        except anthropic.AuthenticationError:
            logger.warning(
                f"Authentication failed for provider config {config.id}",
                extra={"user_id": request.user.id, "provider": config.provider},
            )
            return Response(
                {"success": False, "message": "Invalid API key. Please check your credentials."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except openai.AuthenticationError:
            logger.warning(
                f"Authentication failed for provider config {config.id}",
                extra={"user_id": request.user.id, "provider": config.provider},
            )
            return Response(
                {"success": False, "message": "Invalid API key. Please check your credentials."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except anthropic.RateLimitError:
            return Response(
                {"success": False, "message": "Rate limit exceeded. Please try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        except openai.RateLimitError:
            return Response(
                {"success": False, "message": "Rate limit exceeded. Please try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        except (anthropic.APIConnectionError, openai.APIConnectionError):
            return Response(
                {"success": False, "message": "Could not connect to the AI provider. Please try again."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        except ValueError as e:
            # Handle encryption/decryption errors
            error_str = str(e)
            if "decrypt" in error_str.lower() or "encrypt" in error_str.lower():
                logger.error(f"Encryption error for config {config.id}: {error_str}")
                return Response(
                    {"success": False, "message": "Configuration error. Please reconfigure your API key."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {"success": False, "message": "Invalid configuration."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception as e:
            # Log the full error for debugging but don't expose to user
            logger.exception(
                f"Unexpected error testing connection for config {config.id}",
                extra={"user_id": request.user.id, "provider": config.provider},
            )
            return Response(
                {"success": False, "message": "An unexpected error occurred. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def _sanitize_error_message(self, message: str | None) -> str:
        """Sanitize error messages to prevent sensitive data exposure.

        Args:
            message: The raw error message.

        Returns:
            A sanitized error message safe for client display.
        """
        if not message:
            return "An error occurred."

        # Remove potential API key patterns (sk-..., key-..., etc.)
        import re
        sanitized = re.sub(r'\b(sk-|key-|api-)[a-zA-Z0-9_-]+\b', '[REDACTED]', message)

        # Truncate long messages
        if len(sanitized) > 200:
            sanitized = sanitized[:200] + "..."

        return sanitized

    @action(detail=True, methods=["post"])
    def set_default(self, request: Request, pk=None) -> Response:
        """Set this provider as the default."""
        config = self.get_object()
        config.is_default = True
        config.save()
        return Response({"message": f"{config.get_provider_display()} set as default"})


class AIAccessCheckView(APIView):
    """Check if the current user has AI access."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        """Check if user has AI access.

        Returns:
            200 with has_access boolean.
        """
        user = request.user

        # Staff always has access
        if user.is_staff:
            return Response({"has_access": True, "reason": "staff"})

        # Check AIUserProfile for access permission
        if hasattr(user, "ai_profile") and user.ai_profile.has_ai_access:
            return Response({"has_access": True, "reason": "granted"})

        # In development mode, allow all authenticated users
        from django.conf import settings
        if settings.DEBUG:
            return Response({"has_access": True, "reason": "debug_mode"})

        return Response({"has_access": False, "reason": "not_granted"})


class ToolListView(APIView):
    """List all available AI tools."""

    permission_classes = [IsAuthenticated, IsAIUser]

    def get(self, request: Request) -> Response:
        """List all registered tools.

        Returns tools grouped by category with their schemas.

        Query parameters:
            category: Optional category filter.

        Returns:
            200 with list of tools.
        """
        registry = get_registry()
        category = request.query_params.get("category")

        if category:
            tools = registry.get_tools_by_category(category)
        else:
            tools = registry.get_all_tools()

        return Response({
            "tools": [t.to_dict() for t in tools],
            "count": len(tools),
            "categories": registry.get_categories(),
        })


class ToolExecuteView(APIView):
    """Execute a specific tool directly."""

    permission_classes = [IsAuthenticated, IsAIUser]

    def post(self, request: Request, name: str) -> Response:
        """Execute a tool by name.

        This endpoint allows direct tool execution for testing
        and programmatic access outside of chat context.

        Args:
            name: The tool name from the URL path.

        Request body:
            arguments: Dict of tool arguments.
            project_id: Optional project context.

        Returns:
            200 with tool result on success.
            400 with error on validation failure.
            404 if tool not found.
        """
        registry = get_registry()
        tool = registry.get_tool(name)

        if tool is None:
            return Response(
                {"error": f"Tool '{name}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get arguments from request body
        arguments = request.data.get("arguments", {})
        project_id = request.data.get("project_id")

        # Create execution context
        context = ContextManager.from_request(
            request._request,
            project_id=project_id,
        )

        # Execute the tool
        executor = ToolExecutor(registry, context)
        result = executor.execute(name, arguments)

        # Return appropriate status code based on result
        if result.success:
            return Response(result.to_dict())

        # Map error types to status codes
        error_type = result.error.error_type if result.error else "Unknown"
        status_map = {
            "ValidationError": status.HTTP_400_BAD_REQUEST,
            "ToolNotFoundError": status.HTTP_404_NOT_FOUND,
            "PermissionError": status.HTTP_403_FORBIDDEN,
            "ContextError": status.HTTP_400_BAD_REQUEST,
            "ValueError": status.HTTP_400_BAD_REQUEST,
        }
        response_status = status_map.get(error_type, status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(result.to_dict(), status=response_status)
