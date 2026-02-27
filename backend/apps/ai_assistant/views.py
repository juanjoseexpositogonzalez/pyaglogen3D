"""AI Assistant views."""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from .models import AIProviderConfig
from .permissions import IsAIUser
from .serializers import AIProviderConfigListSerializer, AIProviderConfigSerializer
from .services import AIService


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

        Returns:
            200 with success message if connection works.
            400 with error message if connection fails.
        """
        config = self.get_object()

        # Create AI service and test
        ai_service = AIService(request.user)
        ai_service._provider = None  # Force reload

        # Temporarily use this specific config
        from .services.encryption import get_encryption_service
        from .services.providers import ProviderFactory

        try:
            encryption = get_encryption_service()
            api_key = encryption.decrypt(config.api_key_encrypted)
            provider = ProviderFactory.create_from_config(config, api_key)

            # Test with a simple request
            response = provider.complete(
                messages=[{"role": "user", "content": "Say 'connected' in one word."}],
                max_tokens=10,
                temperature=0,
            )

            if response.stop_reason.value == "error":
                return Response(
                    {"success": False, "message": response.text},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            return Response({
                "success": True,
                "message": f"Connected to {config.get_provider_display()} ({config.model_name})",
                "response": response.text[:100] if response.text else "",
            })

        except Exception as e:
            return Response(
                {"success": False, "message": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=["post"])
    def set_default(self, request: Request, pk=None) -> Response:
        """Set this provider as the default."""
        config = self.get_object()
        config.is_default = True
        config.save()
        return Response({"message": f"{config.get_provider_display()} set as default"})
