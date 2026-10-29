"""OpenAI provider implementation."""
import json
import logging
from typing import Any

import openai

from .base import BaseProvider
from .models import AIResponse, StopReason, TokenUsage, ToolCall

logger = logging.getLogger(__name__)


class OpenAIProvider(BaseProvider):
    """Provider for OpenAI's GPT models."""

    def __init__(
        self,
        api_key: str,
        model_name: str,
        base_url: str | None = None,
        **kwargs: Any,
    ) -> None:
        """Initialize OpenAI provider.

        Args:
            api_key: OpenAI API key.
            model_name: Model name (e.g., 'gpt-4o').
            base_url: Optional base URL for API (for compatible providers).
            **kwargs: Additional configuration.
        """
        super().__init__(api_key, model_name, **kwargs)
        client_kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        self.client = openai.OpenAI(**client_kwargs)
        self._base_url = base_url

    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "openai"

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
            formatted_messages = self._format_messages(messages, system_prompt)

            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=formatted_messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return self._parse_response(response)

        except openai.APIError as e:
            logger.error(f"OpenAI API error: {e}")
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
            formatted_messages = self._format_messages(messages, system_prompt)
            formatted_tools = self._format_tools(tools)

            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=formatted_messages,
                tools=formatted_tools,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return self._parse_response(response)

        except openai.APIError as e:
            logger.error(f"OpenAI API error: {e}")
            return AIResponse(
                content=f"API Error: {e}",
                stop_reason=StopReason.ERROR,
                provider=self.provider_name,
                model=self.model_name,
            )

    def _format_messages(
        self,
        messages: list[dict[str, Any]],
        system_prompt: str | None = None,
    ) -> list[dict[str, Any]]:
        """Format messages for OpenAI API.

        OpenAI expects messages in format:
        [{"role": "system"|"user"|"assistant"|"tool", "content": "..."}]
        """
        formatted = []

        # Add system prompt if provided
        if system_prompt:
            formatted.append({"role": "system", "content": system_prompt})

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "tool":
                # Tool results need tool_call_id
                formatted.append({
                    "role": "tool",
                    "tool_call_id": msg.get("tool_call_id", ""),
                    "content": content,
                })
            elif role == "assistant" and msg.get("tool_calls"):
                # Assistant message with tool calls
                formatted.append({
                    "role": "assistant",
                    "content": content if content else None,
                    "tool_calls": msg["tool_calls"],
                })
            else:
                formatted.append({"role": role, "content": content})

        return formatted

    def _format_tools(
        self, tools: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Format tools for OpenAI API.

        OpenAI expects tools in format:
        {
            "type": "function",
            "function": {
                "name": "tool_name",
                "description": "Tool description",
                "parameters": {"type": "object", "properties": {...}}
            }
        }
        """
        formatted = []
        for tool in tools:
            formatted.append({
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", tool.get("input_schema", {})),
                },
            })
        return formatted

    def _parse_response(self, response: Any) -> AIResponse:
        """Parse OpenAI response into AIResponse."""
        choice = response.choices[0]
        message = choice.message

        content = message.content
        tool_calls = []

        # Parse tool calls if present
        if message.tool_calls:
            for tc in message.tool_calls:
                try:
                    arguments = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    arguments = {"raw": tc.function.arguments}

                tool_calls.append(
                    ToolCall(
                        id=tc.id,
                        name=tc.function.name,
                        arguments=arguments,
                    )
                )

        # Map stop reason
        finish_reason = choice.finish_reason
        if finish_reason == "tool_calls":
            stop_reason = StopReason.TOOL_USE
        elif finish_reason == "length":
            stop_reason = StopReason.MAX_TOKENS
        elif finish_reason == "stop":
            stop_reason = StopReason.END_TURN
        else:
            stop_reason = StopReason.END_TURN

        # Get usage
        usage = TokenUsage()
        if response.usage:
            usage = TokenUsage(
                input_tokens=response.usage.prompt_tokens,
                output_tokens=response.usage.completion_tokens,
            )

        return AIResponse(
            content=content,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            usage=usage,
            model=response.model,
            provider=self.provider_name,
            raw_response=response.model_dump() if hasattr(response, "model_dump") else None,
        )
