import logging
import pickle

import faiss
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import Session
from pathlib import Path
from app.core.config import settings
from app.models.db import CustomerSupportChatbotData
from app.services.text_normalization import build_passage_representation, tokenize_for_bm25
from rank_bm25 import BM25Okapi


class RAGTrainer:
    """Build a FAISS index from data stored in PostgreSQL."""

    def __init__(self, db: Session, logger: logging.Logger):
        self.db = db
        self.logger = logger

    def run(self) -> None:
        # passage_data = all data from CustomerSupportChatbotData that has an answer
        passage_data = (
            self.db.query(CustomerSupportChatbotData)
            .filter(CustomerSupportChatbotData.answer.isnot(None))
            .order_by(CustomerSupportChatbotData.id)
            .all()
        )

        if not passage_data:
            self.logger.warning("No data available; writing EMPTY FAISS index.")
            model = SentenceTransformer(settings.embeddings_model)
            dim = model.get_sentence_embedding_dimension()
            index = faiss.IndexFlatIP(dim)
            Path(settings.index_file).parent.mkdir(parents=True, exist_ok=True)
            faiss.write_index(index, settings.index_file)
            self.logger.info(f"Wrote empty index (dim={dim}) to {settings.index_file}.")
            Path(settings.bm25_index_file).parent.mkdir(parents=True, exist_ok=True)
            with open(settings.bm25_index_file, "wb") as fh:
                pickle.dump({"tokenized_corpus": []}, fh)
            self.logger.info(f"Wrote empty BM25 data to {settings.bm25_index_file}.")
            return

        self.logger.info("Loading model...")
        model = SentenceTransformer(settings.embeddings_model)
        self.logger.info("Encoding passages...")

        passages_text = [
            build_passage_representation(it.url, it.question, it.answer) for it in passage_data
        ]

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

        self.logger.info("Building BM25 index...")
        tokenized_corpus = [tokenize_for_bm25(text) for text in passages_text]
        bm25 = BM25Okapi(tokenized_corpus)
        bm25_payload = {
            "tokenized_corpus": tokenized_corpus,
            "idf": bm25.idf,
            "doc_len": bm25.doc_len,
            "average_idf": bm25.average_idf,
        }
        self.logger.info(f"Saving BM25 index data to {settings.bm25_index_file}...")
        Path(settings.bm25_index_file).parent.mkdir(parents=True, exist_ok=True)
        with open(settings.bm25_index_file, "wb") as fh:
            pickle.dump(bm25_payload, fh)

        self.logger.info("Done training.")
