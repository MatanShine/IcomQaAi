from fastapi import FastAPI

from app.api.v1.endpoints import router as api_router

app = FastAPI(title="IcomQaAi")
app.include_router(api_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {"status": "ok"}
