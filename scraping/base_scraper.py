from abc import ABC, abstractmethod
import json
import os
from typing import Set, Optional

class BaseScraper(ABC):
    """
    Base scraper providing common functionality and interface for concrete scrapers.
    Concrete scrapers should implement get_urls, get_question, and get_answer.
    """
    def __init__(self, base_url: str, data_path: str, logger):
        """Common initialization for all scrapers."""
        self.base_url = base_url.rstrip('/')
        self.data_path = data_path
        self.logger = logger

    @abstractmethod
    def get_urls(self) -> Set[str]:
        """
        Retrieve a list of URLs to be scraped.
        
        Returns:
            Set[str]: A set of URLs to scrape.
        """
        pass

    @abstractmethod
    def get_question(self, url: str) -> Optional[str]:
        """
        Extract the question from a given URL.
        
        Args:
            url (str): The URL to extract the question from.
            
        Returns:
            Optional[str]: The extracted question or None if not found.
        """
        pass

    @abstractmethod
    def get_answer(self, url: str) -> Optional[str]:
        """
        Extract the answer from a given URL.
        
        Args:
            url (str): The URL to extract the answer from.
            
        Returns:
            Optional[str]: The extracted answer or None if not found.
        """
        pass
    
    def run(self) -> int:
        """
        Run the scraper, collecting data from all URLs and saving to the specified path.
        
        Args:
            data_path (str): Path to the JSON file where data will be saved.
                            Will be created if it doesn't exist.
        """
        # Load existing data if file exists
        if os.path.exists(self.data_path):
            with open(self.data_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = []
            os.makedirs(os.path.dirname(self.data_path) or '.', exist_ok=True)
        existing_urls = {d['url'] for d in data if self.base_url in d['url']}

        urls = self.get_urls() - existing_urls
        
        self.logger.info(f"Found {len(urls)} URLs to process")
        
        for i, url in enumerate(urls, 1):
            self.logger.info(f"[{i}/{len(urls)}] Processing: {url}")
            
            try:
                question = self.get_question(url)
                answer = self.get_answer(url)
                
                data.append({
                    'url': url,
                    'question': question,
                    'answer': answer
                })
                self.logger.info(f"  ✓ Successfully processed")
            except Exception as e:
                self.logger.info(f"  ✗ Error processing {url}: {str(e)}")
        
        with open(self.data_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        self.logger.info(f"\nProcessing complete. Added {len(urls)} new items. Total items: {len(data)}")
        return len(urls)