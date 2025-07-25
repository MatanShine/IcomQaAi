
import json
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
from openai import OpenAI
from dotenv import load_dotenv
import os
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- Explicitly find and load the .env file from the project root ---
# Get the directory of the current script (e.g., /path/to/project/chatbot)
script_dir = os.path.dirname(os.path.abspath(__file__))
# Get the parent directory (the project root)
project_root = os.path.dirname(script_dir)
# Construct the full path to the .env file
dotenv_path = os.path.join(project_root, '.env')
print(f"--- Attempting to load .env file from: {dotenv_path}")

# Load the .env file from the specified path
if os.path.exists(dotenv_path):
    print("--- .env file found. Loading variables...")
    load_dotenv(dotenv_path=dotenv_path)
    # --- Debugging: Check if the key is loaded ---
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        print("--- OPENAI_API_KEY loaded successfully.")
    else:
        print("--- WARNING: OPENAI_API_KEY not found in .env file.")
    # -----------------------------------------
else:
    print("--- Warning: .env file not found.")
# -------------------------------------------------------------------

# Initialize OpenAI client (it will automatically find the key)
client = OpenAI()

# Define file paths
INDEX_FILE = 'data/zebra_support.index'
PASSAGES_FILE = 'data/passages.json'

# 1. Load the FAISS index and passages
print("Loading FAISS index and passages...")
index = faiss.read_index(INDEX_FILE)
with open(PASSAGES_FILE, 'r', encoding='utf-8') as f:
    passage_data = json.load(f)
passages = [item['text'] for item in passage_data]
print("Index and passages loaded.")

# Load the sentence-transformer model
print("Loading sentence-transformer model...")
model = SentenceTransformer('imvladikon/sentence-transformers-alephbert')
print("Model loaded.")

def answer_query(user_q: str):
    # 1. Embed & retrieve
    q_emb = model.encode([user_q], convert_to_numpy=True)
    faiss.normalize_L2(q_emb)
    D, I = index.search(q_emb, k=5)
    
    # Retrieve context with URL and original question
    retrieved_contexts = []
    for i in I[0]:
        item = passage_data[i]
        context_str = f"Source URL: {item.get('url', 'N/A')}\nQuestion: {item.get('question', 'N/A')}\nAnswer: {item['text']}"
        retrieved_contexts.append(context_str)
    
    context = "\n\n---\n\n".join(retrieved_contexts)

    # 2. Craft your prompt
    prompt = f"""
You are a friendly help-desk assistant for ZebraCRM. 
Use ONLY the information in the following excerpts to answer the user’s question as concisely as possible.
Provide the source URL if it's available in the context.
If you don’t know the answer, say “I’m not sure—I couldn’t find that in the manual.”

### User question:
{user_q}

### Relevant manual excerpts:
{context}

### Your answer (short and to the point):
"""
    # 3. Call the LLM
    try:
        resp = client.chat.completions.create(
          model="gpt-4o-mini",
          messages=[{"role":"user","content":prompt}],
          max_tokens=250,
          temperature=0.2,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return f"An error occurred while contacting the language model: {e}"

app = Flask(__name__)
CORS(app)

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')
    if not user_message:
        return jsonify({'error': 'No message provided'}), 400
    response = answer_query(user_message)
    return jsonify({'response': response})

# 4. Simple loop
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'api':
        app.run(host='0.0.0.0', port=5050, debug=True)
    else:
        print("Bot: Hi there! What can I help you with today?")
        while True:
            try:
                q = input("You: ")
                if q.lower() in {"exit", "quit"}:
                    print("Bot: Goodbye!")
                    break
                print("Bot:", answer_query(q))
            except EOFError:
                print("Bot: Goodbye!")
                break
            except KeyboardInterrupt:
                print("\nBot: Goodbye!")
                break