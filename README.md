# IcomQaAi

FastAPI-based service exposing a retrieval augmented generation (RAG) chatbot.
The project scrapes knowledge sources, stores them in PostgreSQL and builds a
FAISS index used to answer questions.

## Project layout

```
IcomQaAi/
├── app/
│   ├── main.py                 # FastAPI app
│   ├── api/v1/endpoints.py     # HTTP endpoints
│   ├── core/config.py          # configuration via pydantic
│   ├── models/db.py            # SQLAlchemy models and session
│   ├── schemas/api.py          # request/response models
│   └── services/               # business logic, scrapers and training
│       └── ...
├── tests/                      # pytest based tests
│   └── test_endpoints.py
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```

## Development

1. Install dependencies:

   ```bash
   pip install -r requirements.txt
   playwright install
   ```

2. Set the required environment variables:

   ```bash
   export DATABASE_URL=postgresql://user:password@localhost:5433/icomqaai
   export OPENAI_API_KEY=your-key
   export YOUTUBE_API_KEY=your-key
   ```

3. Run the server:

    ```bash
    uvicorn app.main:app --reload
    ```

## Docker

Start the API and a PostgreSQL database with Docker Compose:

```bash
docker compose up --build
```

The API will be available at <http://localhost:8000>.

The PostgreSQL database is exposed on port `5433` with the default database
name `icomqaai`.

### Analytics dashboard

Docker Compose also provisions a lightweight analytics stack:

- **Analytics backend** (Node.js/Express) at <http://localhost:4001> serving
  the latest questions and answers from the `customer_support_chatbot_ai`
  table.
- **Analytics frontend** (React + Tailwind CSS) at <http://localhost:4173>
  visualising the freshest conversations in a modern dashboard.


## Tests

Execute the test-suite with:

```bash
pytest
```

## LangGraph Studio

LangGraph Studio provides a visual development environment for building and debugging your LangGraph agent.

### Setup

1. Ensure you have the required dependencies installed (already included in `requirements.txt`):
   - `langgraph`
   - `langgraph-sdk`

2. The project is configured with `langgraph.json` which points to the graph factory at:
   - `app/services/rag_chatbot/graph_factory.py:create_graph`

### Running LangGraph Studio

1. Start the LangGraph development server:

   ```bash
   langgraph dev
   ```

   If port 2024 is already in use, you can specify a different port:

   ```bash
   langgraph dev --port 2025
   ```

2. LangGraph Studio will start a local server at:
   - **API**: `http://127.0.0.1:2024` (or your specified port)
   - **Studio UI**: `https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`
   - **API Docs**: `http://127.0.0.1:2024/docs`

3. Open your browser and navigate to the Studio URL to:
   - Visualize your agent graph structure
   - Debug node execution
   - Test different inputs and see state transitions
   - Inspect messages and state at each step

### Configuration

The `langgraph.json` file configures which graphs are available in Studio:
- **agent**: The main RAG chatbot agent graph

You can modify the graph structure in `app/services/rag_chatbot/graph_factory.py` and see changes reflected in Studio.
