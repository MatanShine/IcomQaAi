from .base_scraper import BaseScraper
from bs4 import BeautifulSoup
from typing import Set
from playwright.sync_api import sync_playwright
import time
import re

class PostmanScraper(BaseScraper):
    def __init__(self, base_url: str, data_path: str, logger):
        super().__init__(base_url, data_path, logger)
    
    def get_urls(self) -> Set[str]:
        urls = set()
        urls.add("https://documenter.getpostman.com/view/14343450/Tzm5Jxfs#82fa2bfd-a865-48f1-9a8f-e36d81e298f1")
        return urls
    
    def get_question(self, url: str) -> str:
        return "איך משתמשים ב API של זברה?"
    
    def get_answer(self, url: str) -> str:
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
        return self.__clean_answer(soup)
        
    def __clean_answer(self, soup):
        for tag in soup(["script", "style"]):
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
        text = main.get_text("\n")
        text = re.sub(r'\n{2,}', '\n\n', text).strip()
        return text