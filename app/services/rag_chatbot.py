import json
import logging
import os
import re
from pathlib import Path
from typing import List

from rank_bm25 import BM25Okapi
from dotenv import load_dotenv
from openai import OpenAI
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db import CustomerSupportChatbotData

SYSTEM_INSTRUCTION = """
You are a helpful customer support assistant for ZebraCRM (זברה). Use ONLY the provided context passages
to answer the user's question as concisely as possible.
Provide the source URL if it's available in the context.
Answer in Hebrew if the question is in Hebrew and and respond in X(language) if the question is in X(language).
If the answer is not in the context, no matter the language of the question, return exactly this answer: "IDK"
"""


class RAGChatbot:
    """Retrieval-Augmented Generation chatbot that serves multiple users concurrently."""

    def __init__(
        self,
        logger: logging.Logger,
        db: Session,
        index_path: str = settings.index_file,
        max_history_messages: int = 20,
        top_k: int = 5,
    ) -> None:
        self.logger = logger
        self.logger.info("Loading passages for BM25 retrieval...")
        self.passages: list[dict] = []
        self.tokenized_passages: list[list[str]] = []
        self._load_passages(db, index_path)
        if self.passages:
            self.bm25 = BM25Okapi(self.tokenized_passages)
            self.logger.info("BM25 index built for %d passages.", len(self.passages))
        else:
            self.bm25 = None
            self.logger.warning("No passages available for retrieval; BM25 index not created.")

        self.logger.info("Loading OpenAI API key...")
        load_dotenv()
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            self.logger.info("OPENAI_API_KEY loaded successfully.")
        else:
            self.logger.warning("WARNING: OPENAI_API_KEY not found in .env file.")
        self.llm = OpenAI(api_key=api_key)
        self.logger.info("LLM initialized.")

        self.max_history_messages = max_history_messages
        self.top_k = top_k
        self.logger.info("RAGChatbot initialized.")

    # ----------------------- Public API -----------------------

    def chat(self, message: str, history: List[str]) -> List[str]:
        """Process a chat message for a given user and return the model's answer."""

        self.logger.debug(f"User message: {message}")

        # Retrieve relevant documents
        retrieved = self.retrieve_contexts(message)

        # Build prompt with conversation history and retrieved passages
        prompt = self.build_prompt(history, message, retrieved)
        try:
            response = self.llm.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.2,
            )
            usage = response.usage
            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0
            return (
                response.choices[0].message.content.strip(),
                retrieved,
                prompt_tokens,
                completion_tokens,
            )
        except Exception as e:  # pragma: no cover - network errors
            return (f"An error occurred while contacting the language model: {e}", retrieved, 0, 0)
    
    async def stream_chat(self, message: str, history: list[str]):
        self.logger.debug(f"User message: {message}")
        retrieved = self.retrieve_contexts(message)
        prompt = self.build_prompt(history, message, retrieved)

        full_answer = []
        # Initialize usage counters and last_chunk to avoid UnboundLocalError
        prompt_tokens = 0
        completion_tokens = 0
        last_chunk = None
        for chunk in self.llm.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            stream_options={"include_usage": True},
            max_tokens=400,
            temperature=0.2,
        ):
            last_chunk = chunk
            if not chunk.choices:
                continue
            token = chunk.choices[0].delta.content or ""
            full_answer.append(token)
            yield token, retrieved, 0, 0  # token streaming

        # usage arrives only in the final chunk
        if last_chunk is not None and hasattr(last_chunk, "usage"):
            prompt_tokens = last_chunk.usage.prompt_tokens
            completion_tokens = last_chunk.usage.completion_tokens

        yield "", retrieved, prompt_tokens, completion_tokens
    
    def build_prompt(self, history: List[str], new_message: str, context_text: str) -> str:
        """Construct a prompt for the LLM."""

        history_text = ""
        for i in range(min(len(history), self.max_history_messages)):
            msg = history[i]
            prefix = "User" if i % 2 == 0 else "Assistant"
            history_text += f"{prefix}: {msg}\n"

        prompt = (
            f"{SYSTEM_INSTRUCTION}\n\n"
            f"### Conversation so far:\n{history_text}\n"
            f"### Retrieved context from manual:\n{context_text}\n\n"
            f"### User question:\n{new_message}\n"
            f"### Your answer (short and to the point):\n"
        )
        return prompt

    def retrieve_contexts(self, query: str) -> str:
        """Tokenize query, search BM25, and return top_k passages."""

        if not self.bm25 or not self.passages:
            return ""

        query_tokens = self._tokenize(query)
        if not query_tokens:
            return ""

        scores = self.bm25.get_scores(query_tokens)
        top_indices = sorted(
            range(len(scores)),
            key=lambda i: scores[i],
            reverse=True,
        )[: self.top_k]

        retrieved_contexts = []
        for i in top_indices:
            item = self.passages[i]
            context_str = (
                f"Source URL: {item.get('url', 'N/A')}\n"
                f"Question: {item.get('question', 'N/A')}\n"
                f"Answer: {item.get('text', '')}"
            )
            retrieved_contexts.append(context_str)

        context = "\n\n---\n\n".join(retrieved_contexts)
        return context

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r"\w+", text.lower())

    def _combine_passage_fields(self, passage: dict) -> str:
        return " ".join(
            part for part in [passage.get("question", ""), passage.get("text", "")]
            if part
        )

    def _load_passages(self, db: Session, index_path: str) -> None:
        if self._load_passages_from_file(index_path):
            return
        self._load_passages_from_db(db)
        if self.passages:
            self._persist_passages(index_path)

    def _load_passages_from_file(self, index_path: str) -> bool:
        if not index_path or not Path(index_path).exists():
            return False
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            self.logger.warning("Failed to load BM25 data from %s: %s", index_path, exc)
            return False

        passages = data.get("passages", [])
        if not passages:
            self.logger.warning("BM25 data file %s is empty.", index_path)
            return False

        self.passages = passages
        self.tokenized_passages = []
        for passage in self.passages:
            tokens = passage.get("tokens")
            if not tokens:
                tokens = self._tokenize(self._combine_passage_fields(passage))
                passage["tokens"] = tokens
            self.tokenized_passages.append(tokens)

        self.logger.info("Loaded %d passages from %s.", len(self.passages), index_path)
        return True

    def _load_passages_from_db(self, db: Session) -> None:
        """Load passages from the database and prepare for retrieval."""
        self.logger.info("Loading passages from database...")
        db_items = db.query(CustomerSupportChatbotData).all()
        self.passages = []
        self.tokenized_passages = []
        for item in db_items:
            if not item.answer:
                continue
            passage = {
                "text": item.answer or "",
                "question": item.question or "",
                "url": item.url or "",
            }
            tokens = self._tokenize(self._combine_passage_fields(passage))
            passage["tokens"] = tokens
            self.passages.append(passage)
            self.tokenized_passages.append(tokens)

        self.logger.info("Loaded %d passages from database.", len(self.passages))

    def _persist_passages(self, index_path: str) -> None:
        if not index_path:
            return
        try:
            Path(index_path).parent.mkdir(parents=True, exist_ok=True)
            with open(index_path, "w", encoding="utf-8") as f:
                json.dump({"passages": self.passages}, f, ensure_ascii=False)
            self.logger.info(
                "Persisted %d passages to %s for BM25 retrieval.", len(self.passages), index_path
            )
        except OSError as exc:
            self.logger.warning("Failed to persist BM25 data to %s: %s", index_path, exc)

    