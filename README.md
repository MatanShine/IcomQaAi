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
   export DATABASE_URL=postgresql://user:password@localhost:5432/icom
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

## Tests

Execute the test-suite with:

```bash
pytest
```
