from .base_scraper import BaseScraper
from bs4 import BeautifulSoup
from typing import Set
from playwright.sync_api import sync_playwright
import time
import re

class PostmanScraper(BaseScraper):
    def __init__(self, base_url: str, data_path: str, logger):
        super().__init__(base_url, data_path, logger)
        self.sections = []
    
    def get_urls(self) -> Set[str]:
        urls = set()
        urls.add("https://documenter.getpostman.com/view/14343450/Tzm5Jxfs#82fa2bfd-a865-48f1-9a8f-e36d81e298f1")
        return urls
    
    def get_question(self, index: int) -> str:
        return "איך משתמשים ב API של זברה: " + self.sections[index][0]
    
    def __get_text_from_url(self, url: str) -> None:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context()
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")

            # Scroll to bottom slowly to trigger lazy loading
            last_height = 0
            while True:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(1)
                new_height = page.evaluate("document.body.scrollHeight")
                if new_height == last_height:
                    break
                last_height = new_height
                self.logger.info(f"Scrolling to bottom, last height: {last_height}")
            html = page.content()
            browser.close()

        soup = BeautifulSoup(html, "html.parser")
        main = self.__clean_html(soup)
        for header in main.select("h2, h3"):
            question = header.get_text().strip()
            # collect siblings until next header
            answer_parts = []
            for sib in header.next_siblings:
                if sib.name in ("h2", "h3"):
                    break
                answer_parts.append(sib.get_text("\n"))
            answer = "\n".join(answer_parts).strip()
            if answer:
                self.sections.append((question, answer))
        
    def __clean_html(self, soup) -> BeautifulSoup:
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
            txt = re.sub(r"<\s+/?", "<", txt) # join tokens like `<\nTAG` -> `<TAG`
            pre.replace_with("\n```\n" + txt.strip() + "\n```\n")
        return main

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