"""BM25 based passage retrieval for the RAG chatbot."""

from __future__ import annotations
import json
import logging
import re
from pathlib import Path
from typing import Tuple, List
from rank_bm25 import BM25Okapi
from sqlalchemy.orm import Session
from app.models.db import CustomerSupportChatbotData
from app.services.rag_chatbot.openai_client import OpenAI
from app.core.config import settings, MODEL


class BM25Retriever:
    """Loads passages and performs BM25 retrieval."""

    def __init__(
        self,
        logger: logging.Logger,
        db: Session,
        index_path: str,
        top_k: int,
    ) -> None:
        self.logger = logger
        self.top_k = top_k
        self.passages: list[dict] = []
        self.tokenized_passages: list[list[str]] = []
        self.bm25: BM25Okapi | None = None
        self._load_passages(db, index_path)
        if self.passages:
            self.bm25 = BM25Okapi(self.tokenized_passages)
            self.logger.info("BM25 index built for %d passages.", len(self.passages))
        else:
            self.logger.warning(
                "No passages available for retrieval; BM25 index not created."
            )
        api_key = settings.openai_api_key
        if api_key:
            self.logger.info("OPENAI_API_KEY loaded successfully.")
        else:
            self.logger.warning(
                "WARNING: OPENAI_API_KEY not found in settings or environment."
            )
        self._client = OpenAI(api_key=api_key)

    def retrieve_contexts(
        self, query: str, history: List[str]
    ) -> dict[int, Tuple[str, str, str]]:
        """Tokenize the query, perform BM25 search, and return top_k.
        Returns a dictionary mapping passage index to [question, answer, url]."""

        if not self.bm25 or not self.passages:
            return {}
        variation = query
        if history != []:
            self.logger.info("History: %s", history)
            try:
                another_variation = self._client.responses.create(
                    model=MODEL,
                    input=f"""You are a query rewriter. Given the chat history and the latest user turn,
rewrite the user turn into a standalone search query that preserves meaning.
History:
{history[-4:]}
User turn: {query}
Return ONLY the rewritten query.""",
                    max_output_tokens=200,
                )
                self.logger.info("Another variation: %s", another_variation.output_text)
                variation = another_variation.output_text
            except Exception as e:
                self.logger.error("Failed to generate another variation: %s", e)

        tokens = self._tokenize_doc_for_bm25(variation)
        if not tokens:
            return {}
        scores = self.bm25.get_scores(tokens)
        top_indices = sorted(
            range(len(scores)),
            key=lambda i: scores[i],
            reverse=True,
        )[: self.top_k]

        result: dict[int, Tuple[str, str, str]] = {}
        for i in top_indices:
            item = self.passages[i]
            result[i] = (
                item.get("question", ""),
                item.get("text", ""),
                item.get("url", ""),
            )
        return result

    # ----------------------- Internal helpers -----------------------
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
                tokens = self._tokenize_doc_for_bm25(
                    self._combine_passage_fields(passage)
                )
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
            tokens = self._tokenize_doc_for_bm25(self._combine_passage_fields(passage))
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
                "Persisted %d passages to %s for BM25 retrieval.",
                len(self.passages),
                index_path,
            )
        except OSError as exc:
            self.logger.warning(
                "Failed to persist BM25 data to %s: %s", index_path, exc
            )

    def _char_ngrams(self, token: str, n: int = 3) -> list[str]:
        if len(token) < n:
            return []
        return [f"§{token[i:i+n]}" for i in range(len(token) - n + 1)]
        # '§' prefix keeps them distinct from word tokens

    def _tokenize_doc_for_bm25(self, text: str) -> list[str]:
        toks = self._tokenize(text)
        out = []
        for t in toks:
            out.append(t)
            if self._is_hebrew(t):
                out.extend(self._char_ngrams(t, 3))
        return out

    def _is_hebrew(self, token: str) -> bool:
        return any(ord(c) >= 0x590 and ord(c) <= 0x5FF for c in token)

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r"\w+", text.lower())

    def _combine_passage_fields(self, passage: dict) -> str:
        return " ".join(
            part
            for part in [passage.get("question", ""), passage.get("text", "")]
            if part
        )
