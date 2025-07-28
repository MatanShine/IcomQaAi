from flask import Flask, request, jsonify
from typing import List
from flask_cors import CORS
from rag_chatbot import RAGChatbot

# Define file paths (relative to project root)
INDEX_FILE = 'data/qa_database.index'
PASSAGES_FILE = 'data/qa_database_passages.json'

# Initialize RAG chatbot (loads index, passages, model, and API key internally)
rag_bot = RAGChatbot(INDEX_FILE, PASSAGES_FILE)

def answer_query(user_q: str, history: List[str]):
    """Delegate user query to the shared RAGChatbot instance."""
    return rag_bot.chat(user_q, history)

app = Flask(__name__)
CORS(app)

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')
    history = data.get('history', [])
    if not user_message:
        return jsonify({'error': 'No message provided'}), 400
    response = answer_query(user_message, history)
    return jsonify({'response': response})

# 4. Simple loop
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'api':
        app.run(host='0.0.0.0', port=5050, debug=True)
    else:
        pass