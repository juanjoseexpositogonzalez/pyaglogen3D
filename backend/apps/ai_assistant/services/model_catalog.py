"""Model catalog service — fetches available models from provider APIs.

Fetches, whitelists, normalizes and recommends models per provider.
SDK version: anthropic>=0.40 (models.list() available).
"""
from __future__ import annotations

import logging
import re
from typing import TypedDict

import anthropic
import openai

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Base URLs for OpenAI-compatible providers
# ---------------------------------------------------------------------------
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
XAI_BASE_URL = "https://api.x.ai/v1"

# ---------------------------------------------------------------------------
# Typed structures
# ---------------------------------------------------------------------------


class ModelInfo(TypedDict):
    id: str
    display_name: str
    context_window: int | None
    is_recommended: bool


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class ProviderAuthError(Exception):
    """Raised when the provider rejects the API key."""


class ProviderUnavailableError(Exception):
    """Raised when the provider is unreachable."""


class ProviderRateLimitError(Exception):
    """Raised when the provider rate-limits the request."""


# ---------------------------------------------------------------------------
# Display name normalization
# ---------------------------------------------------------------------------


def normalize_display_name(model_id: str) -> str:
    """Convert a model ID into a human-friendly display name.

    Examples:
        gpt-4o         → GPT 4o
        claude-sonnet-4-20250514 → Claude Sonnet 4 20250514
        llama-3.3-70b-versatile → Llama 3.3 70B Versatile
    """
    # Split on hyphens
    parts = model_id.split("-")
    result: list[str] = []
    for part in parts:
        # Check for size suffixes like 70b, 8x7b
        if re.match(r"^\d+[bB]$", part) or re.match(r"^\d+x\d+[bB]$", part):
            result.append(part.upper())
        # Acronym-like tokens (2-3 uppercase letters) — keep uppercase
        elif re.match(r"^[a-zA-Z]{2,3}$", part) and part.lower() in (
            "gpt", "llm",
        ):
            result.append(part.upper())
        else:
            result.append(part.capitalize())
    return " ".join(result)


# ---------------------------------------------------------------------------
# Public dispatcher
# ---------------------------------------------------------------------------


def fetch_models(provider: str, api_key: str) -> list[ModelInfo]:
    """Fetch available models from a provider API.

    Args:
        provider: One of 'anthropic', 'openai', 'groq', 'xai'.
        api_key: Decrypted API key.

    Returns:
        Normalized, whitelisted, chat-completion models with one recommended.

    Raises:
        ValueError: Unknown provider.
        ProviderAuthError: Invalid/revoked key.
        ProviderUnavailableError: Network/API down.
        ProviderRateLimitError: Rate limited.
    """
    dispatch = {
        "anthropic": _fetch_anthropic,
        "openai": _fetch_openai,
        "groq": _fetch_groq,
        "xai": _fetch_xai,
    }
    fetcher = dispatch.get(provider)
    if fetcher is None:
        raise ValueError(f"Unknown provider: {provider}")
    return fetcher(api_key)


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------

def _fetch_anthropic(api_key: str) -> list[ModelInfo]:
    """Fetch models from Anthropic's native API."""
    client = anthropic.Anthropic(api_key=api_key)
    try:
        page = client.models.list()
        raw_models = list(page.data)
    except anthropic.AuthenticationError as exc:
        raise ProviderAuthError(str(exc)) from exc
    except anthropic.APIConnectionError as exc:
        raise ProviderUnavailableError(str(exc)) from exc
    except anthropic.RateLimitError as exc:
        raise ProviderRateLimitError(str(exc)) from exc

    # Whitelist: only claude-* models
    filtered = [m for m in raw_models if m.id.startswith("claude-")]

    if not filtered:
        return []

    models = _build_model_infos(filtered)
    _apply_anthropic_recommendation(models)
    return models


def _build_model_infos(raw_models) -> list[ModelInfo]:
    """Convert raw SDK model objects to ModelInfo dicts."""
    return [
        ModelInfo(
            id=m.id,
            display_name=normalize_display_name(m.id),
            context_window=getattr(m, "context_window", None),
            is_recommended=False,
        )
        for m in raw_models
    ]


def _apply_anthropic_recommendation(models: list[ModelInfo]) -> None:
    """Mark the best anthropic model as recommended.

    Priority: sonnet > opus > haiku. Within tier, latest date suffix.
    Single model → always recommended.
    """
    if len(models) == 1:
        models[0]["is_recommended"] = True
        return

    tier_order = {"sonnet": 0, "opus": 1, "haiku": 2}

    def _sort_key(m: ModelInfo) -> tuple[int, str]:
        mid = m["id"]
        tier = 3  # default: worse than haiku
        for name, rank in tier_order.items():
            if name in mid:
                tier = rank
                break
        # Extract date suffix for secondary sort (descending)
        date_match = re.search(r"(\d{8})$", mid)
        date_str = date_match.group(1) if date_match else "00000000"
        return (tier, date_str)

    # Sort: lowest tier first, latest date first (reverse date)
    best = max(models, key=lambda m: (-_sort_key(m)[0], _sort_key(m)[1]))
    best["is_recommended"] = True


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------

def _fetch_openai(api_key: str) -> list[ModelInfo]:
    """Fetch models from OpenAI."""
    return _fetch_openai_compatible(
        api_key=api_key,
        base_url=None,
        whitelist_fn=_openai_whitelist,
        recommend_fn=_openai_recommend,
    )


def _openai_whitelist(model_id: str) -> bool:
    """Keep gpt-*, o1-*, o3-*, o4-* models."""
    return (
        model_id.startswith("gpt-")
        or model_id.startswith("o1-")
        or model_id.startswith("o3-")
        or model_id.startswith("o4-")
    )


def _openai_recommend(models: list[ModelInfo]) -> None:
    """Recommend latest non-mini gpt-4o family, fallback first."""
    if len(models) == 1:
        models[0]["is_recommended"] = True
        return

    # Prefer gpt-4o (not mini, not nano, not instruct)
    exclude_suffixes = ("-mini", "-nano", "-instruct")
    candidates = [
        m for m in models
        if m["id"].startswith("gpt-4o")
        and not any(m["id"].endswith(s) for s in exclude_suffixes)
    ]
    if candidates:
        candidates[0]["is_recommended"] = True
        return

    # Fallback: first model
    models[0]["is_recommended"] = True


# ---------------------------------------------------------------------------
# Groq (OpenAI-compatible)
# ---------------------------------------------------------------------------

def _fetch_groq(api_key: str) -> list[ModelInfo]:
    """Fetch models from Groq (no whitelist — keep all)."""
    return _fetch_openai_compatible(
        api_key=api_key,
        base_url=GROQ_BASE_URL,
        whitelist_fn=None,  # keep all
        recommend_fn=_groq_recommend,
    )


def _groq_recommend(models: list[ModelInfo]) -> None:
    """Recommend llama-3.3 > llama-4 > llama-3.1-70b-versatile > first."""
    if len(models) == 1:
        models[0]["is_recommended"] = True
        return

    # Priority chain
    for pattern in ("llama-3.3", "llama-4", "llama-3.1-70b-versatile"):
        for m in models:
            if m["id"].startswith(pattern) or pattern in m["id"]:
                m["is_recommended"] = True
                return

    # Fallback: first model
    models[0]["is_recommended"] = True


# ---------------------------------------------------------------------------
# xAI (OpenAI-compatible)
# ---------------------------------------------------------------------------

def _fetch_xai(api_key: str) -> list[ModelInfo]:
    """Fetch models from xAI."""
    return _fetch_openai_compatible(
        api_key=api_key,
        base_url=XAI_BASE_URL,
        whitelist_fn=lambda mid: mid.startswith("grok-"),
        recommend_fn=_xai_recommend,
    )


def _xai_recommend(models: list[ModelInfo]) -> None:
    """Recommend latest grok by version, prefer non-mini."""
    if len(models) == 1:
        models[0]["is_recommended"] = True
        return

    def _version_key(m: ModelInfo) -> tuple[int, bool]:
        mid = m["id"]
        # Extract version number (grok-2, grok-3, etc.)
        version_match = re.search(r"grok-(\d+)", mid)
        version = int(version_match.group(1)) if version_match else 0
        is_mini = "mini" in mid
        return (version, not is_mini)  # higher version, non-mini preferred

    best = max(models, key=_version_key)
    best["is_recommended"] = True


# ---------------------------------------------------------------------------
# Shared OpenAI-compatible fetcher
# ---------------------------------------------------------------------------

def _fetch_openai_compatible(
    api_key: str,
    base_url: str | None,
    whitelist_fn: callable | None,
    recommend_fn: callable,
) -> list[ModelInfo]:
    """Shared fetcher for OpenAI-compatible APIs (OpenAI, Groq, xAI)."""
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url

    client = openai.OpenAI(**kwargs)
    try:
        response = client.models.list()
        raw_models = list(response.data)
    except openai.AuthenticationError as exc:
        raise ProviderAuthError(str(exc)) from exc
    except openai.APIConnectionError as exc:
        raise ProviderUnavailableError(str(exc)) from exc
    except openai.RateLimitError as exc:
        raise ProviderRateLimitError(str(exc)) from exc

    # Apply whitelist if provided
    if whitelist_fn:
        raw_models = [m for m in raw_models if whitelist_fn(m.id)]

    if not raw_models:
        return []

    models = [
        ModelInfo(
            id=m.id,
            display_name=normalize_display_name(m.id),
            context_window=None,
            is_recommended=False,
        )
        for m in raw_models
    ]

    recommend_fn(models)
    return models
