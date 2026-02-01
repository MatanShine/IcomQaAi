from __future__ import annotations
from typing import List
from sqlalchemy.orm import Session
from app.models.db import CustomerSupportChatbotData
from app.services.scraping.scrape_cs import ZebraSupportScraper
from app.services.scraping.scrape_postman import PostmanScraper
from app.services.scraping.scrape_youtube import YoutubeScraper
from app.services.training.rag import RAGTrainer
import logging


def _scrape_all(logger: logging.Logger) -> List[dict]:
    """Scrape data from all available sources."""
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
        logger.info(f"Using {scraper.__class__.__name__} to scrape data")
        len_data = len(data)
        source_type = {
            "ZebraSupportScraper": "cs",
            "PostmanScraper": "pm",
            "YoutubeScraper": "yt",
        }.get(scraper.__class__.__name__, "unknown")

        try:
            scraped = scraper.scrape()
            for item in scraped:
                item.setdefault("type", source_type)
                item.setdefault("categories", [])  # Ensure categories is always a list
            data.extend(scraped)
            logger.info(
                f"Scraped {len(data) - len_data} items from {scraper.__class__.__name__}"
            )
        except (ConnectionError, TimeoutError) as e:
            # Network-related errors - recoverable, continue with other scrapers
            logger.warning(
                f"Network error scraping from {scraper.__class__.__name__}: {e}. Continuing with other scrapers..."
            )
            continue
        except Exception as e:
            # Other errors - log with full context but continue
            logger.error(
                f"Failed to scrape from {scraper.__class__.__name__}: {e}",
                exc_info=True
            )
            logger.info(f"Continuing with other scrapers...")
            continue

    logger.info(f"Scraped {len(data)} items in total")
    return data


def add_data(db: Session, logger: logging.Logger) -> int:
    """Add new data from scrapers into the database and reinitialize the chatbot."""
    data = _scrape_all(logger)
    amount_added = 0
    for item in data:
        exists = (
            db.query(CustomerSupportChatbotData)
            .filter(CustomerSupportChatbotData.url == item["url"])
            .first()
        )
        if not exists:
            db.add(CustomerSupportChatbotData(**item))
            amount_added += 1
    if amount_added:
        db.commit()
        RAGTrainer(db, logger).run()
    logger.info(f"Added {amount_added} new items to the database")
    return amount_added
