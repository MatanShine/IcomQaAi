"""Utilities for constructing prompts for the RAG chatbot."""

from __future__ import annotations
import json
from typing import List, Tuple

class PromptBuilder:
    """Builds structured prompts for the language model."""

    def __init__(self, max_history_messages: int) -> None:
        self._max_history_messages = max_history_messages

    def build_prompt(self, history: List[str], new_message: str, context: dict[int, Tuple[str, str, str]]) -> str:
        """Return a JSON prompt string using the provided conversation context."""

        history_text = "["
        for index, message in enumerate(history[-self._max_history_messages:]):
            prefix = "User" if index % 2 == 0 else "Assistant"
            history_text += f"{prefix}: {message}\n"
        history_text += "]"
        
        context_text = "["
        for index, (question, answer, _) in context.items():
            context_text += f"ID: {index}\nQuestion: {question}\nAnswer: {answer}\n"
        context_text += "]"
        
        prompt = f"""
<Conversation>
{history_text}
</Conversation>

<Context>
{context_text}
</Context>

<NewMessage>
User: {new_message}
</NewMessage>
""".strip()
        return prompt
