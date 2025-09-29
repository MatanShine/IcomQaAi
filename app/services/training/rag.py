import json
import logging

import faiss
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import Session
from pathlib import Path
from app.core.config import settings
from app.models.db import CustomerSupportChatbotData


class RAGTrainer:
    """Build a FAISS index from data stored in PostgreSQL."""

    def __init__(self, db: Session, logger: logging.Logger):
        self.db = db
        self.logger = logger

    def run(self) -> None:
        # passage_data = all data from CustomerSupportChatbotData that has an answer
        passage_data = self.db.query(CustomerSupportChatbotData).filter(CustomerSupportChatbotData.answer.isnot(None)).all()

        if not passage_data:
            self.logger.warning("No data available; writing EMPTY FAISS index.")
            model = SentenceTransformer(settings.embeddings_model)
            dim = model.get_sentence_embedding_dimension()
            index = faiss.IndexFlatIP(dim)
            Path(settings.index_file).parent.mkdir(parents=True, exist_ok=True)
            faiss.write_index(index, settings.index_file)
            self.logger.info(f"Wrote empty index (dim={dim}) to {settings.index_file}.")
            return

        self.logger.info("Loading model...")
        model = SentenceTransformer(settings.embeddings_model)
        self.logger.info("Encoding passages...")

        def build_passage(item):
            t = item.url
            q = item.question
            a = item.answer
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
        Path(settings.index_file).parent.mkdir(parents=True, exist_ok=True)
        faiss.write_index(index, settings.index_file)
        self.logger.info("Done training.")
