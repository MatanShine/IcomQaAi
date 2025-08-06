import json
import logging

import faiss
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db import CustomerSupportChatbotData


class RAGTrainer:
    """Build a FAISS index from data stored in PostgreSQL."""

    def __init__(self, db: Session, logger: logging.Logger):
        self.db = db
        self.logger = logger

    def run(self) -> None:
        items = self.db.query(CustomerSupportChatbotData).all()
        passage_data = [
            {"text": it.answer, "question": it.question, "url": it.url}
            for it in items
            if it.answer
        ]
        if not passage_data:
            self.logger.warning("No data available for training")
            return

        self.logger.info("Loading model...")
        model = SentenceTransformer(settings.embeddings_model)
        self.logger.info("Encoding passages...")

        def build_passage(item):
            t = item.get("title", "")
            q = item.get("question", "")
            a = item.get("answer", item.get("text", ""))
            return f"passage: {t}\nשאלה: {q}\nתשובה: {a}"

        passages_text = [build_passage(it) for it in passage_data]

        embs = model.encode(
            passages_text,
            convert_to_numpy=True,
            show_progress_bar=True,
            normalize_embeddings=True,
        )

        self.logger.info("Building FAISS index...")
        index = faiss.IndexFlatIP(embs.shape[1])
        faiss.normalize_L2(embs)
        index.add(embs)

        self.logger.info(f"Index built with {index.ntotal} vectors.")
        self.logger.info(f"Saving index to {settings.index_file}...")
        faiss.write_index(index, settings.index_file)

        self.logger.info(f"Saving passages to {settings.passages_file}...")
        with open(settings.passages_file, "w", encoding="utf-8") as f:
            json.dump(passage_data, f, ensure_ascii=False, indent=4)

        self.logger.info("Done training.")
