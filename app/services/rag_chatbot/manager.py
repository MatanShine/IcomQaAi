"""RAG chatbot orchestration that coordinates retrieval, prompts, and LLM calls."""

from __future__ import annotations

import asyncio
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
        answer, prompt_tokens, completion_tokens = self.openai_client.chat(prompt)
        return answer, retrieved, prompt_tokens, completion_tokens


    async def stream_chat(self, message: str, history: List[str]):
        self.logger.debug("User message: %s", message)
        retrieved = self.retriever.retrieve_contexts(message)
        prompt = self.prompt_builder.build_prompt(history, message, retrieved)
        
        try:
            queue: asyncio.Queue[Tuple[str | None, int | None, int | None]] = asyncio.Queue()
            def _run_blocking():
                try:
                    for token, prompt_tokens, completion_tokens in self.openai_client.stream_chat(prompt):
                        # push each token as it arrives
                        queue.put_nowait((token, prompt_tokens, completion_tokens))
                finally:
                    # sentinel to signal completion
                    queue.put_nowait((None, None, None))

            # start the blocking iterator in a worker thread
            thread_task = asyncio.create_task(asyncio.to_thread(_run_blocking))
            while True:
                token, prompt_tokens, completion_tokens = await queue.get()
                if token is None:
                    yield token, retrieved, prompt_tokens, completion_tokens
                else:
                    yield token, None, prompt_tokens, completion_tokens
                    break
            # ensure the worker finishes
            await thread_task
        except Exception as e:
            yield f"An error occurred while contacting the language model: {e}", retrieved, 0, 0