# Analytics Stack

This directory contains a standalone analytics stack with a TypeScript/Express backend and a Vite + React frontend. The backend exposes read-only metrics for the existing `customer_support_chatbot_ai` and `support_requests` tables, while the frontend visualises the aggregates.

## Backend

- Located in [`backend/`](backend/)
- Uses Prisma for read-only access to PostgreSQL
- Provides REST endpoints for summary metrics, "IDK" session insights, and support request audits
- Run locally with:

```bash
cd analytics/backend
npm install
npm run dev
```

Set the `DATABASE_URL` environment variable to point at the production replica or another read-only instance.

## Frontend

- Located in [`frontend/`](frontend/)
- React + TypeScript + TailwindCSS powered by Vite
- Fetches data from the backend API (configure `VITE_API_BASE_URL` if needed)
- Run locally with:

```bash
cd analytics/frontend
npm install
npm run dev
```

## Docker Compose

A [`docker-compose.yml`](docker-compose.yml) file is provided to launch both services together:

```bash
cd analytics
docker compose up --build
```

Ensure you export `DATABASE_URL` in your shell before running the stack.
