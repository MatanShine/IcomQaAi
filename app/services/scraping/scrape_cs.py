import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import time
from .base_scraper import BaseScraper
import re


class ZebraSupportScraper(BaseScraper):

    def __init__(self, base_url: str, logger):
        super().__init__(base_url, logger)

    def get_urls(self):
        """Grab every /category/.../ link from the homepage navigation."""
        soup = self.__soup(self.base_url)

        categories = set()
        categories.add(self.base_url + "/")
        for a in soup.select("a[href^='" + self.base_url + "/category/']"):
            href = a["href"].rstrip("/")
            categories.add(href + "/")
        all_urls = set()
        for cat in categories:
            all_urls |= self.__get_all_article_urls_for_category(cat)
        self.logger.info(f"\nTotal unique articles discovered: {len(all_urls)}\n")
        return all_urls

    def get_question(self, url: str):
        soup = self.__soup(url)

        # Try the original selector for the question
        q = soup.select_one("h1.entry-title")
        if not q:
            # Fallback: try the first h1, then h2, then title
            q = soup.find("h1") or soup.find("h2")
        if not q:
            # Fallback: try the <title>
            q = soup.find("title")
        return q.get_text(strip=True) if q else ""

    def get_answer(self, url: str):
        """Fetches a Q&A page and pulls out the question & answer, auto-detecting selectors if needed."""
        soup = self.__soup(url)

        # Try the original selector for the answer
        ans_blocks = soup.select("div.entry-content p, div.entry-content li")
        if not ans_blocks:
            ans_blocks = soup.select(".wp-block-list")
        if not ans_blocks:
            # Fallback: try all <article> <p>, then all <p> under main content
            ans_blocks = soup.select("article p")
        if not ans_blocks:
            # Fallback: try all <p> tags (as last resort)
            ans_blocks = soup.find_all("p")
        ans = "\n\n".join(
            p.get_text(strip=True) for p in ans_blocks if p.get_text(strip=True)
        )
        if not ans:
            return ""
        return self.__clean_answer(ans)

    def __clean_answer(self, text):
        text = re.sub(r"האם המאמר עזר לך\?\s*YesNo\s*\d+/\d+", "", text)
        text = re.sub(r"YesNo\s*\d+/\d+", "", text)
        return text.strip()

    def __soup(self, url: str):
        resp = requests.get(url)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def __get_all_article_urls_for_category(self, cat_url: str):
        """Page through /page/2/, /page/3/, … until no new article URLs are found."""
        seen = set()
        page = 1
        links = set()
        while page == 1 or links:
            url = cat_url + f"page/{page}/?s"
            self.logger.info(f"Fetching {url}…")
            resp = requests.get(url)
            if resp.status_code == 404:
                break
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            links = set(
                a["href"].rstrip("/") + "/"
                for a in soup.find_all("a", href=True)
                if self.__is_article_url(a["href"])
            )
            self.logger.info(
                f"  [{cat_url.split('/')[-2]}] found {len(links)} on page {page}"
            )
            seen |= links
            page += 1
            time.sleep(0.3)
        return seen

    def __is_article_url(self, href: str):
        """
        Returns True if href is a BASE_URL URL whose path is exactly one slug,
        e.g. https://support.zebracrm.com/reset-api-key/
        """
        if not href.startswith(self.base_url):
            return False
        path = urlparse(href).path
        parts = [p for p in path.split("/") if p]
        return len(parts) == 1
