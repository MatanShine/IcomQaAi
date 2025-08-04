from __future__ import annotations

from typing import List

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db import QAItem, init_db
from app.services.rag_chatbot import RAGChatbot
from app.services.scraping.scrape_cs import ZebraSupportScraper
from app.services.scraping.scrape_postman import PostmanScraper
from app.services.scraping.scrape_youtube import YoutubeScraper
from app.services.training.rag import RAGTrainer

import logging

logger = logging.getLogger("services")

# Ensure tables exist
init_db()

# Initialise chatbot
rag_bot = RAGChatbot(settings.index_file, settings.passages_file, logger)


def chat(message: str, history: List[str] | None = None) -> str:
    return rag_bot.chat(message, history or [])


def _scrape_all() -> List[dict]:
    scrapers = [
        ZebraSupportScraper("https://support.zebracrm.com", logger),
        PostmanScraper(
            "https://documenter.getpostman.com/view/14343450/Tzm5Jxfs#82fa2bfd-a865-48f1-9a8f-e36d81e298f1",
            logger,
        ),
        YoutubeScraper("https://www.youtube.com", logger),
    ]
    data: List[dict] = []
    for scraper in scrapers:
        data.extend(scraper.scrape())
    return data


def add_data(session: Session) -> int:
    """Add new data from scrapers into the database."""

    data = _scrape_all()
    added = 0
    for item in data:
        exists = session.query(QAItem).filter(QAItem.url == item["url"]).first()
        if not exists:
            session.add(QAItem(**item))
            added += 1
    if added:
        session.commit()
        RAGTrainer(session, logger).run()
    return added


def rebuild_database(session: Session) -> int:
    """Wipe and rebuild the database from scratch."""

    session.query(QAItem).delete()
    session.commit()
    data = _scrape_all()
    for item in data:
        session.add(QAItem(**item))
    session.commit()
    RAGTrainer(session, logger).run()
    return len(data)
