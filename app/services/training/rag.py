import json
import logging
import re
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db import CustomerSupportChatbotData


class RAGTrainer:
    """Prepare BM25-compatible corpus from data stored in the database."""

    def __init__(self, db: Session, logger: logging.Logger):
        self.db = db
        self.logger = logger

    def run(self) -> None:
        passage_data = (
            self.db.query(CustomerSupportChatbotData)
            .filter(CustomerSupportChatbotData.answer.isnot(None))
            .all()
        )

        Path(settings.index_file).parent.mkdir(parents=True, exist_ok=True)

        if not passage_data:
            self.logger.warning("No data available; writing empty BM25 corpus.")
            self._write_passages([])
            return

        passages = []
        for item in passage_data:
            passage = {
                "text": item.answer or "",
                "question": item.question or "",
                "url": item.url or "",
            }
            passage["tokens"] = self._tokenize(self._combine_fields(passage))
            passages.append(passage)

        self._write_passages(passages)
        self.logger.info("Prepared BM25 corpus with %d passages.", len(passages))

    def _combine_fields(self, passage: dict) -> str:
        return " ".join(
            part
            for part in [passage.get("question", ""), passage.get("text", "")]
            if part
        )

    def _tokenize(self, text: str) -> list[str]:
        return re.findall(r"\w+", text.lower())

    def _write_passages(self, passages: list[dict]) -> None:
        payload = {"passages": passages}
        with open(settings.index_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        self.logger.info("Saved BM25 corpus to %s.", settings.index_file)
