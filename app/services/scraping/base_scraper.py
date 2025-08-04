from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Set


class BaseScraper(ABC):
    """Common interface for all scrapers.

    Concrete scrapers implement :meth:`get_urls`, :meth:`get_question` and
    :meth:`get_answer`.  The :meth:`scrape` helper iterates over the URLs and
    collects question/answer pairs without persisting them anywhere.  It is the
    caller's responsibility to store the returned data (e.g. in PostgreSQL).
    """

    def __init__(self, base_url: str, logger) -> None:
        self.base_url = base_url.rstrip("/")
        self.logger = logger

    @abstractmethod
    def get_urls(self) -> Set[str]:
        """Return the set of URLs the scraper should visit."""

    @abstractmethod
    def get_question(self, url: str) -> Optional[str]:
        """Extract a question from ``url``."""

    @abstractmethod
    def get_answer(self, url: str) -> Optional[str]:
        """Extract an answer from ``url``."""

    def scrape(self) -> List[Dict[str, str]]:
        """Collect data from all URLs and return it as a list of dictionaries."""

        urls = self.get_urls()
        data: List[Dict[str, str]] = []
        for i, url in enumerate(urls, 1):
            self.logger.info(f"[{i}/{len(urls)}] Processing: {url}")
            try:
                question = self.get_question(url)
                answer = self.get_answer(url)
                data.append({"url": url, "question": question or "", "answer": answer or ""})
                self.logger.info("  ✓ Successfully processed")
            except Exception as exc:  # pragma: no cover - network errors
                self.logger.info(f"  ✗ Error processing {url}: {exc}")

        self.logger.info(f"Finished processing {len(data)} items")
        return data
