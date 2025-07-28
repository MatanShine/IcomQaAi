import json
from sentence_transformers import SentenceTransformer
import faiss
import logging

# Define file paths
INDEX_FILE = 'data/qa_database.index'
PASSAGES_FILE = 'data/qa_database_passages.json'

class RAGTrainer:
    def __init__(self, data_path: str, logger: logging.Logger):
        self.logger = logger
        self.data_path = data_path

        with open(data_path, 'r', encoding='utf-8') as f:
            self.data = json.load(f)

        self.passages = [item['answer'] for item in self.data if 'answer' in item and item['answer']]
        # Storing questions and urls as well for context
        self.passage_data = [{'text': item['answer'], 'question': item.get('question', ''), 'url': item.get('url', '')} for item in self.data if 'answer' in item and item['answer']]

    def run(self):
        self.logger.info("Loading model...")
        model = SentenceTransformer('imvladikon/sentence-transformers-alephbert')
        self.logger.info("Encoding passages...")
        embs = model.encode(self.passages, convert_to_numpy=True, show_progress_bar=True)

        # Build and save FAISS index
        self.logger.info("Building FAISS index...")
        index = faiss.IndexFlatIP(embs.shape[1])
        faiss.normalize_L2(embs)
        index.add(embs)

        self.logger.info(f"Index built with {index.ntotal} vectors.")

        self.logger.info(f"Saving index to {INDEX_FILE}...")
        faiss.write_index(index, INDEX_FILE)

        # Save the passages data
        self.logger.info(f"Saving passages to {PASSAGES_FILE}...")
        with open(PASSAGES_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.passage_data, f, ensure_ascii=False, indent=4)

        self.logger.info("Done training.")
