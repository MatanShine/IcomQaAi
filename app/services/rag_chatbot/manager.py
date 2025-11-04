"""RAG chatbot orchestration that coordinates retrieval, prompts, and LLM calls."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Dict, List, Tuple

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
        retrieved_text, id_url_map = self.retriever.retrieve_contexts(message)
        prompt = self.prompt_builder.build_prompt(history, message, retrieved_text)
        answer, prompt_tokens, completion_tokens = self.openai_client.chat(prompt)
        final_answer, _ = self._post_process_answer(answer, id_url_map)
        return final_answer, retrieved_text, prompt_tokens, completion_tokens

    async def stream_chat(self, message: str, history: List[str]):
        self.logger.debug("User message: %s", message)
        retrieved_text, id_url_map = self.retriever.retrieve_contexts(message)
        prompt = self.prompt_builder.build_prompt(history, message, retrieved_text)

        try:
            queue: asyncio.Queue[Tuple[str | None, int | None, int | None]] = asyncio.Queue()
            collected_tokens: List[str] = []
            final_prompt_tokens: int | None = None
            final_completion_tokens: int | None = None

            def _run_blocking():
                try:
                    for token, prompt_tokens, completion_tokens in self.openai_client.stream_chat(prompt):
                        queue.put_nowait((token, prompt_tokens, completion_tokens))
                finally:
                    queue.put_nowait((None, None, None))

            thread_task = asyncio.create_task(asyncio.to_thread(_run_blocking))
            while True:
                token, prompt_tokens, completion_tokens = await queue.get()
                if prompt_tokens is not None:
                    final_prompt_tokens = prompt_tokens
                if completion_tokens is not None:
                    final_completion_tokens = completion_tokens
                if token is None:
                    break
                if token:
                    collected_tokens.append(token)
                    yield token, None, prompt_tokens, completion_tokens

            raw_answer = "".join(collected_tokens)
            source_id = self._extract_source_id(raw_answer.strip())
            link_line = self._build_link_line(source_id, id_url_map)
            if link_line:
                suffix = "\n" if raw_answer and not raw_answer.endswith("\n") else ""
                yield f"{suffix}{link_line}", None, final_prompt_tokens, final_completion_tokens

            yield None, retrieved_text, final_prompt_tokens or 0, final_completion_tokens or 0
            await thread_task
        except Exception as e:
            yield f"An error occurred while contacting the language model: {e}", retrieved_text, 0, 0

    # ----------------------- Internal helpers -----------------------
    def _post_process_answer(self, answer: str, id_url_map: Dict[int, str]) -> Tuple[str, int | None]:
        cleaned_answer = answer.strip()
        source_id = self._extract_source_id(cleaned_answer)
        link_line = self._build_link_line(source_id, id_url_map)
        if link_line and link_line not in cleaned_answer.splitlines()[-1:]:
            if cleaned_answer and not cleaned_answer.endswith("\n"):
                cleaned_answer += "\n"
            cleaned_answer += link_line
        return cleaned_answer, source_id

    def _extract_source_id(self, answer: str) -> int | None:
        match = re.search(r"Source ID:\s*(\d+)", answer, re.IGNORECASE)
        if not match:
            return None
        try:
            return int(match.group(1))
        except ValueError:
            return None

    def _build_link_line(self, source_id: int | None, id_url_map: Dict[int, str]) -> str | None:
        if source_id is None:
            return None
        url = id_url_map.get(source_id)
        if not url:
            url = "N/A"
        return f"link: {url}"
