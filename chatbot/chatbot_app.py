from flask import Flask, request, jsonify
from typing import List
from flask_cors import CORS
from rag_chatbot import RAGChatbot
from constants.constants import INDEX_FILE, PASSAGES_FILE, DEFAULT_PORT, DATA_PATH
import logging
import sys
from scraping.scrape_youtube import YoutubeScraper
from scraping.scrape_postman import PostmanScraper
from scraping.scrape_cs import ZebraSupportScraper
from training.rag import RAGTrainer
# Initialize RAG chatbot (loads index, passages, model, and API key internally)
logging.basicConfig(
    level=logging.INFO,                        # show INFO and above
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,                         # send to terminal
)
logger = logging.getLogger("CustomerSupportChatbot")
rag_bot = RAGChatbot(INDEX_FILE, PASSAGES_FILE, logger)
rag = RAGTrainer(DATA_PATH, logger)

def answer_query(user_q: str, history: List[str]):
    """Delegate user query to the shared RAGChatbot instance."""
    return rag_bot.chat(user_q, history)

app = Flask(__name__)
CORS(app)

@app.route('/create_database', methods=['GET'])
def create_database():
    added_items = 0
    zs_scraper = ZebraSupportScraper("https://support.zebracrm.com", DATA_PATH, logger)
    added_items += zs_scraper.add_data_to_existing_json()
    pm_scraper = PostmanScraper("https://documenter.getpostman.com/view/14343450/Tzm5Jxfs#82fa2bfd-a865-48f1-9a8f-e36d81e298f1", DATA_PATH, logger)
    added_items += pm_scraper.add_data_to_existing_json()
    yt_scraper = YoutubeScraper("https://www.youtube.com", DATA_PATH, logger)
    added_items += yt_scraper.add_data_to_existing_json()
    if added_items > 0:
        rag.run()
    return jsonify({'amount_added': added_items})

@app.route('/rewrite_database', methods=['GET'])
def rewrite_database():
    zs_scraper = ZebraSupportScraper("https://support.zebracrm.com", DATA_PATH, logger)
    added_items = zs_scraper.rewrite_json()
    pm_scraper = PostmanScraper("https://documenter.getpostman.com/view/14343450/Tzm5Jxfs#82fa2bfd-a865-48f1-9a8f-e36d81e298f1", DATA_PATH, logger)
    added_items += pm_scraper.rewrite_json()
    yt_scraper = YoutubeScraper("https://www.youtube.com", DATA_PATH, logger)
    added_items += yt_scraper.rewrite_json()
    rag.run()
    return jsonify({'amount_added': added_items})

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')
    history = data.get('history', [])
    if not user_message:
        return jsonify({'error': 'No message provided'}), 400
    response = answer_query(user_message, history)
    return jsonify({'response': response})

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == 'api':
        app.run(host='0.0.0.0', port=DEFAULT_PORT, debug=True)
    else:
        pass