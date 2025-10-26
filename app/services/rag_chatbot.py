import logging
import os
import pickle
from collections import defaultdict
from dataclasses import dataclass
from typing import List, Sequence

import faiss
from dotenv import load_dotenv
from openai import OpenAI
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder, SentenceTransformer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db import CustomerSupportChatbotData
from app.services.text_normalization import (
    HEBREW_STOPWORDS,
    build_passage_representation,
    normalize_hebrew_text,
    pick_key_terms,
    tokenize_for_bm25,
)

SYSTEM_INSTRUCTION = """
You are a helpful customer support assistant for ZebraCRM (זברה). Use ONLY the provided context passages
to answer the user's question as concisely as possible.
Provide the source URL if it's available in the context.
Answer in Hebrew if the question is in Hebrew and and respond in X(language) if the question is in X(language).
If the answer is not in the context, no matter the language of the question, return exactly this answer: "IDK"
"""


@dataclass
class RetrievalResult:
    context: str
    passages: List[dict]
    is_confident: bool
    clarifications: List[str]
    rerank_scores: List[float]
    candidate_ids: List[int]


class RAGChatbot:
    """Retrieval-Augmented Generation chatbot that serves multiple users concurrently."""

    def __init__(
        self,
        logger: logging.Logger,
        db: Session,
        index_path: str = settings.index_file,
        model: str = settings.embeddings_model,
        max_history_messages: int = 20,
        top_k: int = 5,
    ) -> None:
        self.logger = logger
        self.logger.info("Loading embedding model...")
        self.model = SentenceTransformer(model)
        self.logger.info("Loading FAISS index...")
        self.index = faiss.read_index(index_path)
        self._load_passages_from_db(db)
        self._load_bm25_index()
        self.logger.info("Loading cross-encoder model for reranking...")
        self.cross_encoder = CrossEncoder(settings.cross_encoder_model)
        self.logger.info("Indexes and models loaded.")

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
        self.rrf_k = 60
        self.vector_top_n = 20
        self.bm25_top_n = 20
        self.fusion_size = 30
        self.low_score_threshold = 0.15
        self.gap_ratio_threshold = 0.1
        self.min_term_overlap = 1
        self.logger.info("RAGChatbot initialized.")

    # ----------------------- Public API -----------------------

    def chat(self, message: str, history: List[str]) -> List[str]:
        """Process a chat message for a given user and return the model's answer."""

        self.logger.debug(f"User message: {message}")

        # Retrieve relevant documents
        retrieval = self.retrieve_contexts(message)

        if not retrieval.is_confident:
            clarification = self._format_clarification_response(retrieval.clarifications)
            return clarification, retrieval.context, 0, 0

        # Build prompt with conversation history and retrieved passages
        prompt = self.build_prompt(history, message, retrieval.context)
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
                retrieval.context,
                prompt_tokens,
                completion_tokens,
            )
        except Exception as e:  # pragma: no cover - network errors
            return (
                f"An error occurred while contacting the language model: {e}",
                retrieval.context,
                0,
                0,
            )

    async def stream_chat(self, message: str, history: list[str]):
        self.logger.debug(f"User message: {message}")
        retrieval = self.retrieve_contexts(message)

        if not retrieval.is_confident:
            clarification = self._format_clarification_response(retrieval.clarifications)
            yield clarification, retrieval.context, 0, 0
            return

        prompt = self.build_prompt(history, message, retrieval.context)

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
            yield token, retrieval.context, 0, 0  # token streaming

        # usage arrives only in the final chunk
        if last_chunk is not None and hasattr(last_chunk, "usage"):
            prompt_tokens = last_chunk.usage.prompt_tokens
            completion_tokens = last_chunk.usage.completion_tokens

        yield "", retrieval.context, prompt_tokens, completion_tokens
    
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

    def retrieve_contexts(self, query: str) -> RetrievalResult:
        """Retrieve candidate passages using hybrid search and rerank them."""

        if not self.passages:
            return RetrievalResult("", [], False, [], [], [])

        query_variants = self._generate_query_variants(query)
        vector_rankings: list[list[int]] = []
        bm25_rankings: list[list[int]] = []

        for variant in query_variants:
            vector_rankings.append(
                [doc_id for doc_id, _ in self._search_vector(variant, self.vector_top_n)]
            )
            if self.bm25:
                bm25_rankings.append(
                    [doc_id for doc_id, _ in self._search_bm25(variant, self.bm25_top_n)]
                )

        fused_candidates = self._reciprocal_rank_fusion(vector_rankings + bm25_rankings)
        candidate_ids = fused_candidates[: self.fusion_size]

        reranked = self._rerank_with_cross_encoder(query, candidate_ids)
        reranked_sorted = sorted(reranked, key=lambda x: x[1], reverse=True)

        top_entries: List[dict] = []
        contexts: List[str] = []
        rerank_scores: List[float] = []
        for doc_id, score in reranked_sorted[: self.top_k]:
            if doc_id < 0 or doc_id >= len(self.passages):
                continue
            passage = self.passages[doc_id]
            rerank_scores.append(score)
            top_entries.append(passage)
            context_str = (
                f"Source URL: {passage.get('url', 'N/A') or 'N/A'}\n"
                f"Question: {passage.get('question', 'N/A') or 'N/A'}\n"
                f"Answer: {passage.get('answer', '')}"
            )
            contexts.append(context_str)

        context_text = "\n\n---\n\n".join(contexts)

        query_tokens = tokenize_for_bm25(query)
        is_confident = self._assess_confidence(query_tokens, reranked_sorted)
        clarifications: List[str] = []
        if not is_confident:
            clarifications = self._generate_clarification_options(query, query_tokens)

        return RetrievalResult(
            context=context_text,
            passages=top_entries,
            is_confident=is_confident,
            clarifications=clarifications,
            rerank_scores=rerank_scores,
            candidate_ids=candidate_ids,
        )

    def _generate_query_variants(self, query: str) -> List[str]:
        normalized = normalize_hebrew_text(query)
        variants: List[str] = []
        base = query.strip()
        if base:
            variants.append(base)
        if normalized and normalized not in variants:
            variants.append(normalized)

        tokens = tokenize_for_bm25(normalized)
        filtered = [t for t in tokens if t not in HEBREW_STOPWORDS]
        if filtered:
            condensed = " ".join(filtered[:8])
            if condensed and condensed not in variants:
                variants.append(condensed)

        return variants[:3] if variants else [normalized]

    def _search_vector(self, query: str, top_n: int) -> List[tuple[int, float]]:
        if not self.passages:
            return []
        normalized = normalize_hebrew_text(query)
        query_emb = self.model.encode([normalized], convert_to_numpy=True)
        faiss.normalize_L2(query_emb)
        search_k = min(top_n, len(self.passages)) or 1
        scores, idxs = self.index.search(query_emb, search_k)
        results: List[tuple[int, float]] = []
        if scores.size == 0:
            return results
        for idx, score in zip(idxs[0], scores[0]):
            if idx < 0 or idx >= len(self.passages):
                continue
            results.append((int(idx), float(score)))
        return results

    def _search_bm25(self, query: str, top_n: int) -> List[tuple[int, float]]:
        if not self.bm25:
            return []
        tokens = tokenize_for_bm25(query)
        if not tokens:
            return []
        scores = self.bm25.get_scores(tokens)
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        limited = []
        for doc_id, score in ranked[: min(top_n, len(self.passages))]:
            if score <= 0:
                continue
            limited.append((int(doc_id), float(score)))
        return limited

    def _reciprocal_rank_fusion(self, rankings: Sequence[Sequence[int]]) -> List[int]:
        fusion_scores = defaultdict(float)
        for ranking in rankings:
            seen: set[int] = set()
            for position, doc_id in enumerate(ranking, start=1):
                if doc_id in seen:
                    continue
                seen.add(doc_id)
                fusion_scores[doc_id] += 1.0 / (self.rrf_k + position)
        sorted_docs = sorted(fusion_scores.items(), key=lambda x: x[1], reverse=True)
        return [doc_id for doc_id, _ in sorted_docs]

    def _rerank_with_cross_encoder(
        self, query: str, candidate_ids: Sequence[int]
    ) -> List[tuple[int, float]]:
        if not candidate_ids:
            return []

        normalized_query = normalize_hebrew_text(query)
        pairs: List[tuple[str, str]] = []
        valid_ids: List[int] = []
        for doc_id in candidate_ids:
            if doc_id < 0 or doc_id >= len(self.passages):
                continue
            valid_ids.append(doc_id)
            pairs.append((normalized_query, self.passages[doc_id]["combined"]))

        if not pairs:
            return []

        scores = self.cross_encoder.predict(pairs)
        if hasattr(scores, "tolist"):
            score_list = scores.tolist()
        else:
            score_list = list(scores)
        return list(zip(valid_ids, score_list))

    def _assess_confidence(
        self, query_tokens: Sequence[str], reranked: Sequence[tuple[int, float]]
    ) -> bool:
        if not reranked:
            return False

        top_score = reranked[0][1]
        if top_score < self.low_score_threshold:
            return False

        if len(reranked) > 1:
            second_score = reranked[1][1]
            gap_ratio = (top_score - second_score) / max(abs(top_score), 1e-6)
            if gap_ratio < self.gap_ratio_threshold:
                return False

        query_terms = pick_key_terms(query_tokens, max_terms=5)
        if not query_terms:
            query_terms = [tok for tok in query_tokens if tok]
        query_term_set = set(query_terms)

        top_doc_id = reranked[0][0]
        if top_doc_id >= len(self.passage_tokens):
            return False
        top_terms = set(pick_key_terms(self.passage_tokens[top_doc_id], max_terms=10))
        overlap = len(query_term_set & top_terms)
        return overlap >= self.min_term_overlap

    def _generate_clarification_options(
        self, query: str, query_tokens: Sequence[str]
    ) -> List[str]:
        key_terms = pick_key_terms(query_tokens, max_terms=3)
        if not key_terms:
            key_terms = pick_key_terms(tokenize_for_bm25(query), max_terms=3)

        options: List[str] = []
        if key_terms:
            main = key_terms[0]
            options.append(f"האם תוכל לפרט יותר לגבי '{main}'?")
        if len(key_terms) > 1:
            options.append(
                f"האם הכוונה לנושא של {key_terms[1]} בהקשר של הגדרות חשבון או משהו אחר?"
            )
        options.append("תוכל לתאר בקצרה מה ניסית לעשות לפני שנתקלת בבעיה?")

        # Ensure 2-3 unique, non-empty options
        unique_options: List[str] = []
        for option in options:
            if option and option not in unique_options:
                unique_options.append(option)
        return unique_options[:3]

    def _format_clarification_response(self, options: Sequence[str]) -> str:
        if not options:
            return "אני צריך עוד מידע כדי לעזור. תוכל לפרט את הבקשה שלך?"

        lines = [
            "אני לא בטוח שהבנתי את השאלה. בחר אחת מהאפשרויות או נסח מחדש בבקשה:",
        ]
        for idx, option in enumerate(options, start=1):
            lines.append(f"{idx}. {option}")
        return "\n".join(lines)
    
    def _load_passages_from_db(self, db: Session) -> None:
        """Load passages from the database and prepare for retrieval."""
        self.logger.info("Loading passages from database...")
        db_items = (
            db.query(CustomerSupportChatbotData)
            .filter(CustomerSupportChatbotData.answer.isnot(None))
            .order_by(CustomerSupportChatbotData.id)
            .all()
        )

        self.passages: List[dict] = []
        for item in db_items:
            combined = build_passage_representation(item.url, item.question, item.answer)
            passage_entry = {
                "id": item.id,
                "url": item.url or "",
                "question": normalize_hebrew_text(item.question),
                "answer": normalize_hebrew_text(item.answer),
                "combined": combined,
            }
            self.passages.append(passage_entry)

        self.passage_texts = [p["combined"] for p in self.passages]
        self.passage_tokens = [tokenize_for_bm25(text) for text in self.passage_texts]
        self.logger.info(f"Loaded {len(self.passages)} passages from database.")

    def _load_bm25_index(self) -> None:
        """Load a persisted BM25 index or rebuild it from passages."""

        self.logger.info("Loading BM25 index...")
        bm25_payload = None
        if os.path.exists(settings.bm25_index_file):
            try:
                with open(settings.bm25_index_file, "rb") as fh:
                    bm25_payload = pickle.load(fh)
            except Exception as exc:  # pragma: no cover - safety net for corrupt files
                self.logger.warning(f"Failed to load BM25 index: {exc}. Rebuilding in-memory.")

        if bm25_payload and bm25_payload.get("tokenized_corpus"):
            tokenized_corpus = bm25_payload["tokenized_corpus"]
            if len(tokenized_corpus) == len(self.passages):
                self.bm25 = BM25Okapi(tokenized_corpus)
                self.passage_tokens = tokenized_corpus
                if "idf" in bm25_payload:
                    self.bm25.idf = bm25_payload["idf"]
                if "doc_len" in bm25_payload:
                    self.bm25.doc_len = bm25_payload["doc_len"]
                if "average_idf" in bm25_payload:
                    self.bm25.average_idf = bm25_payload["average_idf"]
                self.logger.info("BM25 index loaded from disk.")
                return
            self.logger.warning(
                "BM25 payload size does not match passages. Rebuilding in-memory index."
            )

        if not self.passages:
            self.bm25 = None
            self.logger.info("No passages available for BM25 index.")
            return

        self.logger.info("Building BM25 index in-memory from passages.")
        self.bm25 = BM25Okapi(self.passage_tokens)
    