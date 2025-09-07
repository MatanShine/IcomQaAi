from fastapi import FastAPI
import logging

# Ensure app logs appear in terminal (including BackgroundTasks)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
# Align uvicorn loggers to INFO as well
logging.getLogger("uvicorn").setLevel(logging.INFO)
logging.getLogger("uvicorn.error").setLevel(logging.INFO)
logging.getLogger("uvicorn.access").setLevel(logging.INFO)

from app.api.v1.endpoints import router as api_router

app = FastAPI(title="IcomQaAi")
app.include_router(api_router, prefix="/api/v1")

@app.get("/")
async def root():
    return {"status": "ok"}
