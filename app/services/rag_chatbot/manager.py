"""RAG chatbot orchestration that coordinates retrieval, prompts, and LLM calls."""

from __future__ import annotations
import asyncio
import logging
from typing import List, Tuple
from sqlalchemy.orm import Session
from app.core.config import settings
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
        max_history_messages: int = 10,
        top_k: int = 5,
    ) -> None:
        self.logger = logger
        self.retriever = BM25Retriever(logger, db, index_path, top_k)
        self.prompt_builder = PromptBuilder(max_history_messages)
        self.openai_client = OpenAIChatClient(logger)
        self.logger.info("RAGChatbot initialized.")

    # ----------------------- Public API -----------------------
    def chat(self, message: str, history: List[str]) -> Tuple[str, str, int, int]:
        """Process a chat message and return the response with metadata."""

        self.logger.debug("User message: %s", message)
        retrieved = self.retriever.retrieve_contexts(message, history)
        self.logger.debug("Retrieved %d contexts.", len(retrieved))
        prompt = self.prompt_builder.build_prompt(history, message, retrieved)
        answer, answerId, prompt_tokens, completion_tokens = self.openai_client.chat(
            prompt
        )
        answer = self.add_url(retrieved, answer, answerId)
        return answer, retrieved, prompt_tokens, completion_tokens

    async def stream_chat(self, message: str, history: List[str]):
        self.logger.debug("User message: %s", message)
        retrieved = self.retriever.retrieve_contexts(message, history)
        self.logger.debug("Retrieved %d contexts.", len(retrieved))
        prompt = self.prompt_builder.build_prompt(history, message, retrieved)
        try:
            queue: asyncio.Queue[Tuple[str | None, int | None, int | None]] = (
                asyncio.Queue()
            )

            def _run_blocking():
                try:
                    for (
                        token,
                        answerId,
                        prompt_tokens,
                        completion_tokens,
                    ) in self.openai_client.stream_chat(prompt):
                        queue.put_nowait(
                            (token, answerId, prompt_tokens, completion_tokens)
                        )
                finally:
                    queue.put_nowait((None, None, None, None))

            thread_task = asyncio.create_task(asyncio.to_thread(_run_blocking))
            while True:
                token, answerId, prompt_tokens, completion_tokens = await queue.get()
                if token == "":
                    token = self.add_url(retrieved, token, answerId)
                    yield token, None, prompt_tokens, completion_tokens
                elif token is None:
                    yield None, retrieved, prompt_tokens, completion_tokens
                    break
                else:
                    yield token, None, prompt_tokens, completion_tokens
            # ensure the worker finishes
            await thread_task
        except Exception as e:
            yield f"An error occurred while contacting the language model: {e}", retrieved, 0, 0

    def add_url(self, retrieved: dict, text: str, answerId: int):
        meta = retrieved.get(answerId)
        if meta:
            if text.strip().lower() == "idk":
                return text
            return text + "\nURL: " + meta[2] + "\n"
        else:
            self.logger.error("No metadata found for answerId: %d", answerId)
            self.logger.error("retrieved ids: %s", retrieved.keys())
            return text
