"""RAG chatbot orchestration that coordinates retrieval, prompts, and LLM calls."""

from __future__ import annotations

import logging
from typing import List, Tuple

from sqlalchemy.orm import Session

from app.core.config import SYSTEM_INSTRUCTION, settings
from .openai_client import OpenAIChatClient
from .prompt_builder import PromptBuilder
from .retriever import BM25Retriever


class RAGChatbot:
    """Retrieval-Augmented Generation chatbot that delegates to helper components."""

    def __init__(
        self,
        logger: logging.Logger,
        db: Session,
        index_path: str = settings.index_file,
        max_history_messages: int = 20,
        top_k: int = 8,
    ) -> None:
        self.logger = logger
        self.retriever = BM25Retriever(logger, db, index_path, top_k)
        self.prompt_builder = PromptBuilder(SYSTEM_INSTRUCTION, max_history_messages)
        self.openai_client = OpenAIChatClient(logger)
        self.logger.info("RAGChatbot initialized.")

    # ----------------------- Public API -----------------------
    def chat(self, message: str, history: List[str]) -> Tuple[str, str, int, int]:
        """Process a chat message and return the response with metadata."""

        self.logger.debug("User message: %s", message)
        retrieved = self.retriever.retrieve_contexts(message)
        prompt = self.prompt_builder.build_prompt(history, message, retrieved)

        try:
            answer, prompt_tokens, completion_tokens = self.openai_client.chat(prompt)
            return answer, retrieved, prompt_tokens, completion_tokens
        except Exception as exc:  # pragma: no cover - network errors
            return (
                f"An error occurred while contacting the language model: {exc}",
                retrieved,
                0,
                0,
            )

    async def stream_chat(self, message: str, history: List[str]):
        self.logger.debug("User message: %s", message)
        retrieved = self.retriever.retrieve_contexts(message)
        prompt = self.prompt_builder.build_prompt(history, message, retrieved)

        try:
            for chunk in self.openai_client.stream_chat(prompt):
                if chunk["is_final"]:
                    yield "", retrieved, chunk["prompt_tokens"], chunk["completion_tokens"]
                else:
                    yield chunk["token"], retrieved, 0, 0
        except Exception as exc:  # pragma: no cover - network errors
            yield (
                f"An error occurred while contacting the language model: {exc}",
                retrieved,
                0,
                0,
            )

