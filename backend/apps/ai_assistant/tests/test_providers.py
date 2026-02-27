"""Tests for AI providers."""
import json
import pytest
from unittest.mock import MagicMock, patch

from apps.ai_assistant.services.providers import (
    AIResponse,
    ProviderFactory,
    StopReason,
    TokenUsage,
    ToolCall,
)
from apps.ai_assistant.services.providers.anthropic_provider import AnthropicProvider
from apps.ai_assistant.services.providers.openai_provider import OpenAIProvider
from apps.ai_assistant.services.providers.groq_provider import GroqProvider
from apps.ai_assistant.services.providers.xai_provider import XAIProvider


class TestAIResponseModel:
    """Tests for AIResponse dataclass."""

    def test_default_values(self):
        """Test AIResponse default values."""
        response = AIResponse()
        assert response.content is None
        assert response.tool_calls == []
        assert response.stop_reason == StopReason.END_TURN
        assert response.usage.total_tokens == 0
        assert response.model == ""
        assert response.provider == ""

    def test_has_tool_calls_false(self):
        """Test has_tool_calls when no tool calls."""
        response = AIResponse(content="Hello")
        assert response.has_tool_calls is False

    def test_has_tool_calls_true(self):
        """Test has_tool_calls when tool calls exist."""
        response = AIResponse(
            tool_calls=[ToolCall(id="1", name="test", arguments={})]
        )
        assert response.has_tool_calls is True

    def test_text_property_with_content(self):
        """Test text property with content."""
        response = AIResponse(content="Hello world")
        assert response.text == "Hello world"

    def test_text_property_without_content(self):
        """Test text property without content."""
        response = AIResponse(content=None)
        assert response.text == ""


class TestTokenUsage:
    """Tests for TokenUsage dataclass."""

    def test_total_tokens(self):
        """Test total_tokens calculation."""
        usage = TokenUsage(input_tokens=100, output_tokens=50)
        assert usage.total_tokens == 150


class TestToolCall:
    """Tests for ToolCall dataclass."""

    def test_tool_call_creation(self):
        """Test ToolCall creation."""
        tc = ToolCall(
            id="call_123",
            name="run_simulation",
            arguments={"n_particles": 500},
        )
        assert tc.id == "call_123"
        assert tc.name == "run_simulation"
        assert tc.arguments == {"n_particles": 500}


class TestProviderFactory:
    """Tests for ProviderFactory."""

    def test_get_supported_providers(self):
        """Test getting supported providers."""
        providers = ProviderFactory.get_supported_providers()
        assert "anthropic" in providers
        assert "openai" in providers
        assert "groq" in providers
        assert "xai" in providers

    def test_create_anthropic_provider(self):
        """Test creating Anthropic provider."""
        provider = ProviderFactory.create_provider(
            provider_name="anthropic",
            api_key="test-key",
            model_name="claude-sonnet-4-20250514",
        )
        assert isinstance(provider, AnthropicProvider)
        assert provider.provider_name == "anthropic"

    def test_create_openai_provider(self):
        """Test creating OpenAI provider."""
        provider = ProviderFactory.create_provider(
            provider_name="openai",
            api_key="test-key",
            model_name="gpt-4o",
        )
        assert isinstance(provider, OpenAIProvider)
        assert provider.provider_name == "openai"

    def test_create_groq_provider(self):
        """Test creating Groq provider."""
        provider = ProviderFactory.create_provider(
            provider_name="groq",
            api_key="test-key",
            model_name="llama-3.3-70b-versatile",
        )
        assert isinstance(provider, GroqProvider)
        assert provider.provider_name == "groq"

    def test_create_xai_provider(self):
        """Test creating xAI provider."""
        provider = ProviderFactory.create_provider(
            provider_name="xai",
            api_key="test-key",
            model_name="grok-beta",
        )
        assert isinstance(provider, XAIProvider)
        assert provider.provider_name == "xai"

    def test_create_unknown_provider_raises_error(self):
        """Test that unknown provider raises ValueError."""
        with pytest.raises(ValueError, match="Unknown provider"):
            ProviderFactory.create_provider(
                provider_name="unknown",
                api_key="test-key",
                model_name="test-model",
            )


class TestAnthropicProvider:
    """Tests for AnthropicProvider."""

    def test_provider_name(self):
        """Test provider name."""
        with patch("anthropic.Anthropic"):
            provider = AnthropicProvider(
                api_key="test-key",
                model_name="claude-sonnet-4-20250514",
            )
            assert provider.provider_name == "anthropic"

    def test_format_messages(self):
        """Test message formatting."""
        with patch("anthropic.Anthropic"):
            provider = AnthropicProvider(
                api_key="test-key",
                model_name="claude-sonnet-4-20250514",
            )
            messages = [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there"},
            ]
            formatted = provider._format_messages(messages)
            assert formatted == messages

    def test_format_tools(self):
        """Test tool formatting."""
        with patch("anthropic.Anthropic"):
            provider = AnthropicProvider(
                api_key="test-key",
                model_name="claude-sonnet-4-20250514",
            )
            tools = [
                {
                    "name": "test_tool",
                    "description": "A test tool",
                    "parameters": {"type": "object", "properties": {}},
                }
            ]
            formatted = provider._format_tools(tools)
            assert formatted[0]["name"] == "test_tool"
            assert formatted[0]["description"] == "A test tool"
            assert "input_schema" in formatted[0]


class TestOpenAIProvider:
    """Tests for OpenAIProvider."""

    def test_provider_name(self):
        """Test provider name."""
        with patch("openai.OpenAI"):
            provider = OpenAIProvider(
                api_key="test-key",
                model_name="gpt-4o",
            )
            assert provider.provider_name == "openai"

    def test_format_messages_with_system_prompt(self):
        """Test message formatting with system prompt."""
        with patch("openai.OpenAI"):
            provider = OpenAIProvider(
                api_key="test-key",
                model_name="gpt-4o",
            )
            messages = [{"role": "user", "content": "Hello"}]
            formatted = provider._format_messages(messages, "You are helpful.")

            assert formatted[0]["role"] == "system"
            assert formatted[0]["content"] == "You are helpful."
            assert formatted[1]["role"] == "user"

    def test_format_tools(self):
        """Test tool formatting for OpenAI."""
        with patch("openai.OpenAI"):
            provider = OpenAIProvider(
                api_key="test-key",
                model_name="gpt-4o",
            )
            tools = [
                {
                    "name": "test_tool",
                    "description": "A test tool",
                    "parameters": {"type": "object", "properties": {}},
                }
            ]
            formatted = provider._format_tools(tools)
            assert formatted[0]["type"] == "function"
            assert formatted[0]["function"]["name"] == "test_tool"


class TestGroqProvider:
    """Tests for GroqProvider."""

    def test_provider_name(self):
        """Test provider name."""
        with patch("openai.OpenAI"):
            provider = GroqProvider(
                api_key="test-key",
                model_name="llama-3.3-70b-versatile",
            )
            assert provider.provider_name == "groq"

    def test_base_url(self):
        """Test that Groq uses correct base URL."""
        assert GroqProvider.GROQ_BASE_URL == "https://api.groq.com/openai/v1"


class TestXAIProvider:
    """Tests for XAIProvider."""

    def test_provider_name(self):
        """Test provider name."""
        with patch("openai.OpenAI"):
            provider = XAIProvider(
                api_key="test-key",
                model_name="grok-beta",
            )
            assert provider.provider_name == "xai"

    def test_base_url(self):
        """Test that xAI uses correct base URL."""
        assert XAIProvider.XAI_BASE_URL == "https://api.x.ai/v1"
