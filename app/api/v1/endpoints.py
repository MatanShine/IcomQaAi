from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.models.db import SessionLocal
from app.schemas.api import ChatRequest, ChatResponse, OperationResponse
from app.services import svc

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/create_database", response_model=OperationResponse)
def create_database(db: Session = Depends(get_db)):
    added = svc.add_data(db)
    return OperationResponse(amount_added=added)


@router.get("/rewrite_database", response_model=OperationResponse)
def rewrite_database(db: Session = Depends(get_db)):
    added = svc.rebuild_database(db)
    return OperationResponse(amount_added=added)


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    response = svc.chat(req.message, req.history or [])
    return ChatResponse(response=response)
