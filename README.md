# IcomQaAi - RAG Chatbot

This project implements a Retrieval-Augmented Generation (RAG) chatbot that answers questions based on a provided knowledge base. The chatbot uses a sentence-transformer model to embed text, FAISS for efficient similarity search, and a large language model (LLM) to generate answers.

## Setup

1.  **Create and activate a virtual environment:**

    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    ```

2.  **Install the required dependencies:**

    ```bash
    pip install -r requirements.txt
    ```

3.  **Set up your OpenAI API key:**

    Make sure you have an OpenAI API key. You can set it as an environment variable:

    ```bash
    export OPENAI_API_KEY='your-openai-api-key'
    ```

## Running the Project

1.  **Generate the FAISS index and passages:**

    First, you need to process the knowledge base and create the necessary index files. Run the following command from the root of the project:

    ```bash
    python -m training.rag
    ```

    This script will:
    -   Load the data from `data/zebra_support_qa.json`.
    -   Generate embeddings for the text passages using a sentence-transformer model.
    -   Create a FAISS index and save it to `data/zebra_support.index`.
    -   Save the passages to `data/passages.json`.

2.  **Start the chatbot:**

    Once the index is created, you can start the interactive chatbot:

    ```bash
    python3 -m chatbot.chatbot
    ```

    The chatbot will load the index and passages, and you can start asking questions in the terminal. To exit, type `exit` or `quit`.

3.  **Run the API server:**

    Start the API version of the chatbot:

    ```bash
    python chatbot/chatbot.py api
    ```

4.  **Launch the web interface:**

    Run the PHP built-in server from the `web` directory:

    ```bash
    cd web
    php -S localhost:8080
    ```
