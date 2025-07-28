from scraping.scrape_cs import ZebraSupportScraper
from scraping.scrape_youtube import YoutubeScraper
from scraping.scrape_postman import PostmanScraper
import logging
from training.rag import RAGTrainer
import sys

DATA_PATH = "data/qa_database.json"

def create_database(data_path: str, logger: logging.Logger):
    added_items = 0
    zs_scraper = ZebraSupportScraper("https://support.zebracrm.com", data_path, logger)
    added_items += zs_scraper.run()
    pm_scraper = PostmanScraper("https://documenter.getpostman.com/view/14343450/Tzm5Jxfs#82fa2bfd-a865-48f1-9a8f-e36d81e298f1", data_path, logger)
    added_items += pm_scraper.run()
    yt_scraper = YoutubeScraper("https://www.youtube.com", data_path, logger)
    added_items += yt_scraper.run()
    return added_items
def data_training(data_path: str, logger: logging.Logger):
    rag = RAGTrainer(data_path, logger)
    rag.run()

def main():
    logging.basicConfig(
        level=logging.INFO,                        # show INFO and above
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stdout,                         # send to terminal
    )
    logger = logging.getLogger("create_bot")
    added_items = create_database(DATA_PATH, logger)
    if added_items > 0:
        data_training(DATA_PATH, logger)
    else:
        logger.info("No training needed as no new items were added to the database.")

if __name__ == "__main__":
    main()