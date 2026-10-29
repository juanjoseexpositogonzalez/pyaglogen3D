"""Tests for ModelCatalogService (Phase 2)."""
import pytest
from unittest.mock import MagicMock, patch

from apps.ai_assistant.services.model_catalog import (
    ModelInfo,
    ProviderAuthError,
    ProviderRateLimitError,
    ProviderUnavailableError,
    fetch_models,
    normalize_display_name,
)


# ---------------------------------------------------------------------------
# Mock helpers — ensure ALL exception classes exist on the mock module
# ---------------------------------------------------------------------------

def _setup_anthropic_mock(mock_mod):
    """Configure a mock anthropic module with real exception subclasses."""
    mock_mod.AuthenticationError = type("AuthenticationError", (Exception,), {})
    mock_mod.APIConnectionError = type("APIConnectionError", (Exception,), {
        "__init__": lambda self, *a, **kw: Exception.__init__(self, "conn failed"),
    })
    mock_mod.RateLimitError = type("RateLimitError", (Exception,), {})
    mock_client = MagicMock()
    mock_mod.Anthropic.return_value = mock_client
    return mock_client


def _setup_openai_mock(mock_mod):
    """Configure a mock openai module with real exception subclasses."""
    mock_mod.AuthenticationError = type("AuthenticationError", (Exception,), {})
    mock_mod.APIConnectionError = type("APIConnectionError", (Exception,), {
        "__init__": lambda self, *a, **kw: Exception.__init__(self, "conn failed"),
    })
    mock_mod.RateLimitError = type("RateLimitError", (Exception,), {})
    mock_client = MagicMock()
    mock_mod.OpenAI.return_value = mock_client
    return mock_client


def _make_anthropic_model(model_id: str):
    """Create a mock anthropic Model object."""
    m = MagicMock()
    m.id = model_id
    m.display_name = model_id
    m.context_window = None
    return m


def _make_openai_model(model_id: str):
    """Create a mock openai Model object."""
    m = MagicMock()
    m.id = model_id
    return m


def _make_page(models):
    """Create a mock anthropic paginated response page."""
    page = MagicMock()
    page.data = models
    page.has_more = False
    return page


# ---------------------------------------------------------------------------
# T2.1 — Skeleton: exceptions, dispatcher, unknown provider
# ---------------------------------------------------------------------------

class TestSkeletonAndDispatcher:
    """Test skeleton: exceptions exist, fetch_models dispatches, unknown raises."""

    def test_provider_auth_error_is_exception(self):
        assert issubclass(ProviderAuthError, Exception)

    def test_provider_unavailable_error_is_exception(self):
        assert issubclass(ProviderUnavailableError, Exception)

    def test_provider_rate_limit_error_is_exception(self):
        assert issubclass(ProviderRateLimitError, Exception)

    def test_unknown_provider_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown provider"):
            fetch_models("unknown_provider", "some-key")

    def test_model_info_is_typed_dict(self):
        """ModelInfo should accept the canonical shape."""
        info: ModelInfo = {
            "id": "test-model",
            "display_name": "Test Model",
            "context_window": 4096,
            "is_recommended": False,
        }
        assert info["id"] == "test-model"


# ---------------------------------------------------------------------------
# T2.6 — normalize_display_name
# ---------------------------------------------------------------------------

class TestNormalizeDisplayName:
    """Parametrized test for normalize_display_name."""

    @pytest.mark.parametrize(
        "model_id,expected",
        [
            ("gpt-4o", "GPT 4o"),
            ("gpt-4o-mini", "GPT 4o Mini"),
            ("gpt-4-turbo", "GPT 4 Turbo"),
            ("o1-mini", "O1 Mini"),
            ("o3-mini", "O3 Mini"),
            ("claude-sonnet-4-20250514", "Claude Sonnet 4 20250514"),
            ("claude-3-haiku-20240307", "Claude 3 Haiku 20240307"),
            ("llama-3.3-70b-versatile", "Llama 3.3 70B Versatile"),
            ("grok-2", "Grok 2"),
            ("grok-3-mini-fast", "Grok 3 Mini Fast"),
        ],
    )
    def test_normalize_display_name(self, model_id, expected):
        assert normalize_display_name(model_id) == expected


# ---------------------------------------------------------------------------
# T2.2 — _fetch_anthropic
# ---------------------------------------------------------------------------

class TestFetchAnthropic:
    """Test anthropic provider fetching."""

    @patch("apps.ai_assistant.services.model_catalog.anthropic")
    def test_whitelist_keeps_only_claude_models(self, mock_anthropic_mod):
        mock_client = _setup_anthropic_mock(mock_anthropic_mod)

        page = _make_page([
            _make_anthropic_model("claude-sonnet-4-20250514"),
            _make_anthropic_model("claude-3-haiku-20240307"),
            _make_anthropic_model("not-a-claude-model"),
        ])
        mock_client.models.list.return_value = page

        result = fetch_models("anthropic", "test-key")
        ids = [m["id"] for m in result]
        assert "claude-sonnet-4-20250514" in ids
        assert "claude-3-haiku-20240307" in ids
        assert "not-a-claude-model" not in ids

    @patch("apps.ai_assistant.services.model_catalog.anthropic")
    def test_recommended_model_is_latest_sonnet(self, mock_anthropic_mod):
        mock_client = _setup_anthropic_mock(mock_anthropic_mod)

        page = _make_page([
            _make_anthropic_model("claude-3-haiku-20240307"),
            _make_anthropic_model("claude-3-5-sonnet-20241022"),
            _make_anthropic_model("claude-sonnet-4-20250514"),
        ])
        mock_client.models.list.return_value = page

        result = fetch_models("anthropic", "test-key")
        recommended = [m for m in result if m["is_recommended"]]
        assert len(recommended) == 1
        assert recommended[0]["id"] == "claude-sonnet-4-20250514"

    @patch("apps.ai_assistant.services.model_catalog.anthropic")
    def test_empty_list_returns_empty(self, mock_anthropic_mod):
        mock_client = _setup_anthropic_mock(mock_anthropic_mod)

        page = _make_page([])
        mock_client.models.list.return_value = page

        result = fetch_models("anthropic", "test-key")
        assert result == []

    @patch("apps.ai_assistant.services.model_catalog.anthropic")
    def test_single_model_is_recommended(self, mock_anthropic_mod):
        mock_client = _setup_anthropic_mock(mock_anthropic_mod)

        page = _make_page([_make_anthropic_model("claude-3-haiku-20240307")])
        mock_client.models.list.return_value = page

        result = fetch_models("anthropic", "test-key")
        assert len(result) == 1
        assert result[0]["is_recommended"] is True

    @patch("apps.ai_assistant.services.model_catalog.anthropic")
    def test_auth_error_maps_to_provider_auth_error(self, mock_anthropic_mod):
        mock_client = _setup_anthropic_mock(mock_anthropic_mod)
        mock_client.models.list.side_effect = mock_anthropic_mod.AuthenticationError(
            "Invalid API key"
        )

        with pytest.raises(ProviderAuthError):
            fetch_models("anthropic", "bad-key")

    @patch("apps.ai_assistant.services.model_catalog.anthropic")
    def test_connection_error_maps_to_provider_unavailable(self, mock_anthropic_mod):
        mock_client = _setup_anthropic_mock(mock_anthropic_mod)
        mock_client.models.list.side_effect = mock_anthropic_mod.APIConnectionError(
            request=MagicMock()
        )

        with pytest.raises(ProviderUnavailableError):
            fetch_models("anthropic", "test-key")

    @patch("apps.ai_assistant.services.model_catalog.anthropic")
    def test_rate_limit_maps_to_provider_rate_limit(self, mock_anthropic_mod):
        mock_client = _setup_anthropic_mock(mock_anthropic_mod)
        mock_client.models.list.side_effect = mock_anthropic_mod.RateLimitError(
            "Rate limit exceeded"
        )

        with pytest.raises(ProviderRateLimitError):
            fetch_models("anthropic", "test-key")


# ---------------------------------------------------------------------------
# T2.3 — _fetch_openai
# ---------------------------------------------------------------------------

class TestFetchOpenAI:
    """Test openai provider fetching."""

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_whitelist_keeps_gpt_and_o_models(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [
            _make_openai_model("gpt-4o"),
            _make_openai_model("gpt-4o-mini"),
            _make_openai_model("o1-mini"),
            _make_openai_model("o3-mini"),
            _make_openai_model("o4-mini"),
            _make_openai_model("dall-e-3"),
            _make_openai_model("whisper-1"),
            _make_openai_model("text-embedding-3-small"),
        ]
        mock_client.models.list.return_value = mock_response

        result = fetch_models("openai", "test-key")
        ids = [m["id"] for m in result]
        assert "gpt-4o" in ids
        assert "gpt-4o-mini" in ids
        assert "o1-mini" in ids
        assert "o3-mini" in ids
        assert "o4-mini" in ids
        assert "dall-e-3" not in ids
        assert "whisper-1" not in ids

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_recommended_is_latest_gpt4o_non_mini(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [
            _make_openai_model("gpt-4o"),
            _make_openai_model("gpt-4o-mini"),
            _make_openai_model("gpt-4-turbo"),
            _make_openai_model("o1-mini"),
        ]
        mock_client.models.list.return_value = mock_response

        result = fetch_models("openai", "test-key")
        recommended = [m for m in result if m["is_recommended"]]
        assert len(recommended) == 1
        assert recommended[0]["id"] == "gpt-4o"

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_auth_error(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.AuthenticationError(
            "Invalid API key"
        )

        with pytest.raises(ProviderAuthError):
            fetch_models("openai", "bad-key")

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_connection_error(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.APIConnectionError(
            request=MagicMock()
        )

        with pytest.raises(ProviderUnavailableError):
            fetch_models("openai", "test-key")

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_rate_limit_error(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.RateLimitError(
            "Rate limit exceeded"
        )

        with pytest.raises(ProviderRateLimitError):
            fetch_models("openai", "test-key")


# ---------------------------------------------------------------------------
# T2.4 — _fetch_groq
# ---------------------------------------------------------------------------

class TestFetchGroq:
    """Test groq provider fetching."""

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_no_filter_all_models_kept(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [
            _make_openai_model("llama-3.3-70b-versatile"),
            _make_openai_model("mixtral-8x7b-32768"),
            _make_openai_model("gemma2-9b-it"),
        ]
        mock_client.models.list.return_value = mock_response

        result = fetch_models("groq", "test-key")
        ids = [m["id"] for m in result]
        assert len(ids) == 3
        assert "llama-3.3-70b-versatile" in ids
        assert "mixtral-8x7b-32768" in ids

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_recommended_prefers_llama33(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [
            _make_openai_model("mixtral-8x7b-32768"),
            _make_openai_model("llama-3.3-70b-versatile"),
            _make_openai_model("gemma2-9b-it"),
        ]
        mock_client.models.list.return_value = mock_response

        result = fetch_models("groq", "test-key")
        recommended = [m for m in result if m["is_recommended"]]
        assert len(recommended) == 1
        assert recommended[0]["id"] == "llama-3.3-70b-versatile"

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_recommended_fallback_to_first_if_no_llama(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [
            _make_openai_model("mixtral-8x7b-32768"),
            _make_openai_model("gemma2-9b-it"),
        ]
        mock_client.models.list.return_value = mock_response

        result = fetch_models("groq", "test-key")
        recommended = [m for m in result if m["is_recommended"]]
        assert len(recommended) == 1
        assert recommended[0]["id"] == "mixtral-8x7b-32768"

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_groq_uses_correct_base_url(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [_make_openai_model("llama-3.3-70b-versatile")]
        mock_client.models.list.return_value = mock_response

        fetch_models("groq", "test-key")

        mock_openai_mod.OpenAI.assert_called_once_with(
            api_key="test-key",
            base_url="https://api.groq.com/openai/v1",
        )

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_groq_auth_error(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.AuthenticationError("bad")

        with pytest.raises(ProviderAuthError):
            fetch_models("groq", "bad-key")


# ---------------------------------------------------------------------------
# T2.5 — _fetch_xai
# ---------------------------------------------------------------------------

class TestFetchXAI:
    """Test xAI provider fetching."""

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_whitelist_keeps_only_grok_models(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [
            _make_openai_model("grok-2"),
            _make_openai_model("grok-3-mini-fast"),
            _make_openai_model("some-other-model"),
        ]
        mock_client.models.list.return_value = mock_response

        result = fetch_models("xai", "test-key")
        ids = [m["id"] for m in result]
        assert "grok-2" in ids
        assert "grok-3-mini-fast" in ids
        assert "some-other-model" not in ids

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_recommended_is_latest_grok_by_version(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [
            _make_openai_model("grok-2"),
            _make_openai_model("grok-3-mini-fast"),
            _make_openai_model("grok-3"),
        ]
        mock_client.models.list.return_value = mock_response

        result = fetch_models("xai", "test-key")
        recommended = [m for m in result if m["is_recommended"]]
        assert len(recommended) == 1
        assert recommended[0]["id"] == "grok-3"

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_xai_uses_correct_base_url(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)

        mock_response = MagicMock()
        mock_response.data = [_make_openai_model("grok-2")]
        mock_client.models.list.return_value = mock_response

        fetch_models("xai", "test-key")

        mock_openai_mod.OpenAI.assert_called_once_with(
            api_key="test-key",
            base_url="https://api.x.ai/v1",
        )

    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_xai_auth_error(self, mock_openai_mod):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.AuthenticationError("bad")

        with pytest.raises(ProviderAuthError):
            fetch_models("xai", "bad-key")


# ---------------------------------------------------------------------------
# T2.7 — Error mapping parametrized (all providers with openai-compat SDK)
# ---------------------------------------------------------------------------

class TestErrorMappingParametrized:
    """Parametrized error mapping for openai-compatible providers."""

    @pytest.mark.parametrize("provider", ["openai", "groq", "xai"])
    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_auth_error_across_providers(self, mock_openai_mod, provider):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.AuthenticationError("bad")

        with pytest.raises(ProviderAuthError):
            fetch_models(provider, "bad-key")

    @pytest.mark.parametrize("provider", ["openai", "groq", "xai"])
    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_connection_error_across_providers(self, mock_openai_mod, provider):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.APIConnectionError(
            request=MagicMock()
        )

        with pytest.raises(ProviderUnavailableError):
            fetch_models(provider, "test-key")

    @pytest.mark.parametrize("provider", ["openai", "groq", "xai"])
    @patch("apps.ai_assistant.services.model_catalog.openai")
    def test_rate_limit_across_providers(self, mock_openai_mod, provider):
        mock_client = _setup_openai_mock(mock_openai_mod)
        mock_client.models.list.side_effect = mock_openai_mod.RateLimitError("limited")

        with pytest.raises(ProviderRateLimitError):
            fetch_models(provider, "test-key")
