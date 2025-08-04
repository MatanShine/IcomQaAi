import json
import logging
import os
from typing import List

import faiss
from dotenv import load_dotenv
from openai import OpenAI
from sentence_transformers import SentenceTransformer

from app.core.config import settings

SYSTEM_INSTRUCTION = """
You are a helpful customer support assistant for ZebraCRM (זברה). Use ONLY the provided context passages
to answer the user's question as concisely as possible.
Provide the source URL if it's available in the context.
Answer in Hebrew if the question is in Hebrew and the context is in Hebrew; otherwise respond appropriately.
If the answer is not in the context, say "I don't know—I couldn't find that in the manual. Would you like to contact support?"(translated to Hebrew if asked in hebrew)
"""


class RAGChatbot:
    """Retrieval-Augmented Generation chatbot that serves multiple users concurrently."""

    def __init__(
        self,
        index_path: str,
        passages_path: str,
        logger: logging.Logger = logging.getLogger("CSChatbot"),
        model: str = settings.embeddings_model,
        max_history_messages: int = 6,
        top_k: int = 10,
    ) -> None:
        self.logger = logger
        self.logger.info("Loading embedding model...")
        self.model = SentenceTransformer(model)
        self.logger.info("Loading FAISS index...")
        self.index = faiss.read_index(index_path)
        with open(passages_path, "r", encoding="utf-8") as f:
            self.passages = json.load(f)
        self.passage_texts = [p["text"] for p in self.passages]
        self.logger.info("Index and passages loaded.")

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

    def chat(self, message: str, history: List[str] | None = None) -> str:
        """Process a chat message for a given user and return the model's answer."""

        history = history or []
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
            return response.choices[0].message.content.strip()
        except Exception as e:  # pragma: no cover - network errors
            return f"An error occurred while contacting the language model: {e}"

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
        """Embed query, search FAISS, and return top_k passages."""

        query_emb = self.model.encode([query], convert_to_numpy=True)
        faiss.normalize_L2(query_emb)
        scores, idxs = self.index.search(query_emb, self.top_k)

        retrieved_contexts = []
        for i in idxs[0]:
            item = self.passages[i]
            context_str = (
                f"Source URL: {item.get('url', 'N/A')}\n"
                f"Question: {item.get('question', 'N/A')}\n"
                f"Answer: {item['text']}"
            )
            retrieved_contexts.append(context_str)

        context = "\n\n---\n\n".join(retrieved_contexts)
        return context
