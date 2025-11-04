"""Utilities for constructing prompts for the RAG chatbot."""

from __future__ import annotations

import json
from typing import Sequence


class PromptBuilder:
    """Builds structured prompts for the language model."""

    def __init__(self, system_instruction: dict, max_history_messages: int) -> None:
        self._system_instruction = system_instruction
        self._max_history_messages = max_history_messages

    def build_prompt(
        self,
        history: Sequence[str],
        new_message: str,
        context_text: str,
    ) -> str:
        """Return a JSON prompt string using the provided conversation context."""

        history_text = "["
        for index, message in enumerate(history[: self._max_history_messages]):
            prefix = "User" if index % 2 == 0 else "Assistant"
            history_text += f"{prefix}: {message}\n"
        history_text += "]"

        prompt_data = {
            "instructions": self._system_instruction,
            "conversation_history": history_text,
            "retrieved_context_from_manual": context_text,
            "user_question": new_message,
        }
        return json.dumps(prompt_data, ensure_ascii=False, indent=2)
