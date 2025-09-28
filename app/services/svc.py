from __future__ import annotations
from typing import List
from sqlalchemy.orm import Session
from app.models.db import CustomerSupportChatbotData
from app.services.rag_chatbot import RAGChatbot
from app.services.scraping.scrape_cs import ZebraSupportScraper
from app.services.scraping.scrape_postman import PostmanScraper
from app.services.scraping.scrape_youtube import YoutubeScraper
from app.services.training.rag import RAGTrainer
import logging


def chat(bot: RAGChatbot, message: str, history: List[str] = []) -> List[str]:
    """Process a chat message."""
    return bot.chat(message, history)

def stream_chat(bot: RAGChatbot, message: str, history: List[str] = []) -> List[str]:
    """Stream chat response."""
    return bot.stream_chat(message, history)

def _scrape_all(logger: logging.Logger) -> List[dict]:
    """Scrape data from all available sources."""
    scrapers = [
        ZebraSupportScraper("https://support.zebracrm.com", logger),
        PostmanScraper("https://documenter.getpostman.com/view/14343450/Tzm5Jxfs#82fa2bfd-a865-48f1-9a8f-e36d81e298f1", logger),
        YoutubeScraper("https://www.youtube.com", logger),
    ]
    data: List[dict] = []
    for scraper in scrapers:
        logger.info(f"Using {scraper.__class__.__name__} to scrape data")
        len_data = len(data)
        source_type = {
            'ZebraSupportScraper': 'cs',
            'PostmanScraper': 'pm',
            'YoutubeScraper': 'yt',
        }.get(scraper.__class__.__name__, 'unknown')
        
        try:
            scraped = scraper.scrape()
            for item in scraped:
                item.setdefault('type', source_type)
            data.extend(scraped)
            logger.info(f"Scraped {len(data) - len_data} items from {scraper.__class__.__name__}")
        except Exception as e:
            logger.error(f"Failed to scrape from {scraper.__class__.__name__}: {str(e)}")
            logger.info(f"Continuing with other scrapers...")
            continue
    
    logger.info(f"Scraped {len(data)} items in total")
    return data

def add_data(db: Session, logger: logging.Logger) -> int:
    """Add new data from scrapers into the database and reinitialize the chatbot."""
    data = _scrape_all(logger)
    amount_added = 0
    for item in data:
        exists = db.query(CustomerSupportChatbotData).filter(CustomerSupportChatbotData.url == item["url"]).first()
        if not exists:
            db.add(CustomerSupportChatbotData(**item))
            amount_added += 1
    if amount_added:
        db.commit()
        RAGTrainer(db, logger).run()
    logger.info(f"Added {amount_added} new items to the database")
    return amount_added
