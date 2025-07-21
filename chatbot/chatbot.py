
import json
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
from openai import OpenAI

# Initialize OpenAI client
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

# 4. Simple loop
if __name__ == "__main__":
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