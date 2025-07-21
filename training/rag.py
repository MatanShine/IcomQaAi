
import json
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
import os

# Define file paths
QA_FILE = 'data/zebra_support_qa.json'
INDEX_FILE = 'data/zebra_support.index'
PASSAGES_FILE = 'data/passages.json'

# 1. Load your manual
with open(QA_FILE, 'r', encoding='utf-8') as f:
    qa_data = json.load(f)

passages = [item['answer'] for item in qa_data if 'answer' in item and item['answer']]
# Storing questions and urls as well for context
passage_data = [{'text': item['answer'], 'question': item.get('question', ''), 'url': item.get('url', '')} for item in qa_data if 'answer' in item and item['answer']]


# 2. Embed
print("Loading model...")
model = SentenceTransformer('imvladikon/sentence-transformers-alephbert')
print("Encoding passages...")
embs = model.encode(passages, convert_to_numpy=True, show_progress_bar=True)

# 3. Build and save FAISS index
print("Building FAISS index...")
index = faiss.IndexFlatIP(embs.shape[1])
faiss.normalize_L2(embs)
index.add(embs)

print(f"Index built with {index.ntotal} vectors.")

print(f"Saving index to {INDEX_FILE}...")
faiss.write_index(index, INDEX_FILE)

# 4. Save the passages data
print(f"Saving passages to {PASSAGES_FILE}...")
with open(PASSAGES_FILE, 'w', encoding='utf-8') as f:
    json.dump(passage_data, f, ensure_ascii=False, indent=4)

print("Done.")

def chunk_text(text, chunk_size=500, overlap=50):
    """
    This is a simple chunking function. It's not used in the current script
    but is kept for future reference.
    """
    # Simple sliding window chunking
    return [text[i:i+chunk_size] for i in range(0, len(text), chunk_size - overlap)]