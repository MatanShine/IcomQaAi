"""Client wrapper for interacting with OpenAI chat completions."""

from __future__ import annotations

import logging
from typing import Generator

from dotenv import load_dotenv
from openai import OpenAI

from app.core.config import settings


class OpenAIChatClient:
    """Encapsulates OpenAI chat and streaming interactions."""

    def __init__(self, logger: logging.Logger) -> None:
        load_dotenv()
        api_key = settings.openai_api_key
        if api_key:
            logger.info("OPENAI_API_KEY loaded successfully.")
        else:
            logger.warning("WARNING: OPENAI_API_KEY not found in settings or environment.")
        self._client = OpenAI(api_key=api_key)

    def chat(self, prompt: str, *, model: str = settings.MODEL, max_tokens: int = settings.MAX_TOKEN_RESPONSE, temperature: float = settings.TEMPERATURE_RESPONSE) -> tuple[str, int, int]:
        """Send a chat completion request and return text with usage statistics."""
        try:
            response = self._client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            usage = response.usage
            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0
            content = response.choices[0].message.content or ""
            return content.strip(), prompt_tokens, completion_tokens
        except Exception as e:  # pragma: no cover - network errors
            return f"An error occurred while contacting the language model: {e}", 0, 0

    def stream_chat(self, prompt: str, *, model: str = settings.MODEL, max_tokens: int = settings.MAX_TOKEN_RESPONSE, temperature: float = settings.TEMPERATURE_RESPONSE):
        """Stream chat completion chunks, yielding tokens and final usage."""

        last_chunk = None
        prompt_tokens = 0
        completion_tokens = 0
        for chunk in self._client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            stream_options={"include_usage": True},
            max_tokens=max_tokens,
            temperature=temperature,
        ):
            last_chunk = chunk
            if not chunk.choices:
                continue
            token = chunk.choices[0].delta.content or ""
            yield token, prompt_tokens, completion_tokens

        if last_chunk is not None and hasattr(last_chunk, "usage"):
            prompt_tokens = last_chunk.usage.prompt_tokens
            completion_tokens = last_chunk.usage.completion_tokens
        yield None, prompt_tokens, completion_tokens