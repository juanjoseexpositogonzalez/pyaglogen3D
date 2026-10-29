"""Anthropic (Claude) provider implementation."""
import json
import logging
from typing import Any

import anthropic

from .base import BaseProvider
from .models import AIResponse, StopReason, TokenUsage, ToolCall

logger = logging.getLogger(__name__)


class AnthropicProvider(BaseProvider):
    """Provider for Anthropic's Claude models."""

    def __init__(self, api_key: str, model_name: str, **kwargs: Any) -> None:
        """Initialize Anthropic provider.

        Args:
            api_key: Anthropic API key.
            model_name: Model name (e.g., 'claude-sonnet-4-20250514').
            **kwargs: Additional configuration.
        """
        super().__init__(api_key, model_name, **kwargs)
        self.client = anthropic.Anthropic(api_key=api_key)

    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "anthropic"

    def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        system_prompt: str | None = None,
    ) -> AIResponse:
        """Complete a conversation without tools."""
        try:
            kwargs: dict[str, Any] = {
                "model": self.model_name,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": self._format_messages(messages),
            }
            if system_prompt:
                kwargs["system"] = system_prompt

            response = self.client.messages.create(**kwargs)
            return self._parse_response(response)

        except anthropic.APIError as e:
            logger.error(f"Anthropic API error: {e}")
            return AIResponse(
                content=f"API Error: {e}",
                stop_reason=StopReason.ERROR,
                provider=self.provider_name,
                model=self.model_name,
            )

    def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        system_prompt: str | None = None,
    ) -> AIResponse:
        """Complete a conversation with tool definitions."""
        try:
            kwargs: dict[str, Any] = {
                "model": self.model_name,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": self._format_messages(messages),
                "tools": self._format_tools(tools),
            }
            if system_prompt:
                kwargs["system"] = system_prompt

            response = self.client.messages.create(**kwargs)
            return self._parse_response(response)

        except anthropic.APIError as e:
            logger.error(f"Anthropic API error: {e}")
            return AIResponse(
                content=f"API Error: {e}",
                stop_reason=StopReason.ERROR,
                provider=self.provider_name,
                model=self.model_name,
            )

    def _format_messages(
        self, messages: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Format messages for Anthropic API.

        Anthropic expects messages in format:
        [{"role": "user"|"assistant", "content": "..."}]
        """
        formatted = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            # Handle tool results
            if role == "tool":
                formatted.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": msg.get("tool_call_id", ""),
                            "content": content,
                        }
                    ],
                })
            else:
                formatted.append({"role": role, "content": content})

        return formatted

    def _format_tools(
        self, tools: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Format tools for Anthropic API.

        Anthropic expects tools in format:
        {
            "name": "tool_name",
            "description": "Tool description",
            "input_schema": {"type": "object", "properties": {...}}
        }
        """
        formatted = []
        for tool in tools:
            formatted.append({
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "input_schema": tool.get("parameters", tool.get("input_schema", {})),
            })
        return formatted

    def _parse_response(self, response: Any) -> AIResponse:
        """Parse Anthropic response into AIResponse."""
        content = None
        tool_calls = []

        # Parse content blocks
        for block in response.content:
            if block.type == "text":
                content = block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        arguments=dict(block.input) if block.input else {},
                    )
                )

        # Map stop reason
        stop_reason_map = {
            "end_turn": StopReason.END_TURN,
            "tool_use": StopReason.TOOL_USE,
            "max_tokens": StopReason.MAX_TOKENS,
        }
        stop_reason = stop_reason_map.get(
            response.stop_reason, StopReason.END_TURN
        )

        return AIResponse(
            content=content,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            usage=TokenUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            ),
            model=response.model,
            provider=self.provider_name,
            raw_response=response.model_dump() if hasattr(response, "model_dump") else None,
        )
