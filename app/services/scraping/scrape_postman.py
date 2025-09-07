from __future__ import annotations

import re
from typing import List, Set

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper


class PostmanScraper(BaseScraper):
    """Scrape the Postman API documentation.

    The Postman documentation is a single page containing many sections.  Each
    section is treated as a separate Q&A pair.
    """

    def __init__(self, base_url: str, logger):
        super().__init__(base_url, logger)
        self.sections: List[tuple[str, str]] = []

    def get_urls(self) -> Set[str]:
        return {self.base_url}

    # The base class iterates per URL, but the Postman page contains multiple
    # questions.  We therefore override :meth:`scrape` to return all sections
    # for the single documentation URL.
    def scrape(self) -> List[dict]:  # type: ignore[override]
        self._load_sections(self.base_url)
        data = [
            {
                "url": self.base_url,
                "question": f"איך משתמשים ב API של זברה: {q}",
                "answer": a,
            }
            for q, a in self.sections
        ]
        self.sections = []
        return data

    # -- helpers -----------------------------------------------------------------
    def _load_sections(self, url: str) -> None:
        with sync_playwright() as p:  # pragma: no cover - requires browser
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context()
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")
            last_height = 0
            while True:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(1000)
                new_height = page.evaluate("document.body.scrollHeight")
                if new_height == last_height:
                    break
                last_height = new_height
            html = page.content()
            browser.close()

        soup = BeautifulSoup(html, "html.parser")
        main = self._clean_html(soup)
        for header in main.select("h2, h3"):
            question = header.get_text().strip()
            answer_parts = []
            for sib in header.next_siblings:
                if sib.name in ("h2", "h3"):
                    break
                answer_parts.append(sib.get_text("\n"))
            answer = "\n".join(answer_parts).strip()
            if answer:
                self.sections.append((question, answer))

    def _clean_html(self, soup: BeautifulSoup) -> BeautifulSoup:
        for tag in soup(["script", "style", "img", "svg"]):
            tag.decompose()
        main = soup.select_one("#doc-wrapper")
        for sel in ["[data-testid=topbar]", "#config-bar", ".navbarstyles__NavbarContainer-sc-4bjpr8-0"]:
            for el in main.select(sel):
                el.decompose()
        for el in main.select("button, .highlighted-code__expand-button"):
            el.decompose()
        for pre in main.select("pre"):
            txt = pre.get_text("\n")
            txt = re.sub(r"<\s+/?", "<", txt)
            pre.replace_with("\n```\n" + txt.strip() + "\n```\n")
        return main
    
    def get_question(self, index: int) -> str:
        return "איך משתמשים ב API של זברה: " + self.sections[index][0]
    
    def get_answer(self, index: int) -> str:
        return self.sections[index][1]
    
    def add_new_data(self, data: list) -> int:
        """
        Run the scraper, collecting data from all URLs and saving to the specified path.
        
        Args:
            data_path (str): Path to the JSON file where data will be saved.
                            Will be created if it doesn't exist.
        """
        l = len(data)
        urls = self.find_urls_to_process(data)
        for i, url in enumerate(urls, 1):
            try:
                self.__get_text_from_url(url)
                self.logger.info(f"[{i}/{len(self.sections)}] Processing: {url}")
                for j in range(len(self.sections)):
                    question = self.get_question(j)
                    answer = self.get_answer(j)
                    data.append({
                        'url': url,
                        'question': question,
                        'answer': answer
                    })
                self.sections = []
                self.logger.info(f"  ✓ Successfully processed")
            except Exception as e:
                self.logger.info(f"  ✗ Error processing {url}: {str(e)}")
        
        self.logger.info(f"\nProcessing complete. Added {len(data) - l} new items. Total items: {len(data)}")
        return data