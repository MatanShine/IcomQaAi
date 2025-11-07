"""Client wrapper for interacting with OpenAI chat completions."""

from __future__ import annotations

import json
import logging
from dotenv import load_dotenv
from openai import OpenAI
from .stream_response_seeker import StreamResponseSeeker
from app.core.config import settings, SYSTEM_INSTRUCTION, MODEL
from pydantic import BaseModel

class IdTextFormat(BaseModel):
    response: str
    responseSourceId: int

class OpenAIChatClient:
    """Encapsulates OpenAI chat and streaming interactions."""

    def __init__(self, logger: logging.Logger) -> None:
        load_dotenv()
        self.logger = logger
        api_key = settings.openai_api_key
        if api_key:
            self.logger.info("OPENAI_API_KEY loaded successfully.")
        else:
            self.logger.warning("WARNING: OPENAI_API_KEY not found in settings or environment.")
        self._client = OpenAI(api_key=api_key)

    def chat(self, prompt: str, *, model: str = MODEL) -> tuple[str, int, int, int]:
        """Send a chat completion request and return text with usage statistics."""
        try:
            response = self._client.responses.parse(
                model=model,
                input=prompt,
                text_format=IdTextFormat,
                instructions=json.dumps(SYSTEM_INSTRUCTION, ensure_ascii=False),
            )
            parsed: IdTextFormat = response.output_parsed
            usage = response.usage
            input_tokens = usage.input_tokens if usage else 0
            output_tokens = usage.output_tokens if usage else 0
            content = parsed.response or ""
            return content.strip(), parsed.responseSourceId, input_tokens, output_tokens
        except Exception as e:  # pragma: no cover - network errors
            return f"An error occurred while contacting the language model: {e}", 0, 0, 0

    def stream_chat(self, prompt: str, *, model: str = MODEL):
        """Stream chat completion chunks, yielding tokens and final usage."""
        response_streamer = StreamResponseSeeker()
        with self._client.responses.stream(
            model=model,
            input=prompt,
            text_format=IdTextFormat,
            instructions=json.dumps(SYSTEM_INSTRUCTION, ensure_ascii=False),
        ) as stream:
            for chunk in stream:
                if chunk.type == "response.output_text.delta":
                    for char in response_streamer.feed(chunk.delta):
                        yield char, 0, 0, 0
                elif chunk.type == "response.completed":
                    full = stream.get_final_response()
                    input_tokens = full.usage.input_tokens if full.usage else 0
                    output_tokens = full.usage.output_tokens if full.usage else 0
                    final_parsed: IdTextFormat = full.output_parsed
                    yield "", final_parsed.responseSourceId, input_tokens, output_tokens
