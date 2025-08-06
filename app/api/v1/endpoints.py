from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json

from app.models.db import SessionLocal, CustomerSupportChatbotAI
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
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    answer, retrieved, tokens_sent, tokens_received = svc.chat(req.message, req.history)
    entry = CustomerSupportChatbotAI(question=req.message,
                                     answer=answer,
                                     context=retrieved,
                                     history=req.history,
                                     tokens_sent=tokens_sent,
                                     tokens_received=tokens_received)
    db.add(entry)
    db.commit()
    return ChatResponse(response=answer)

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, db: Session = Depends(get_db)):
    async def token_generator():
        full_answer = []
        tokens_sent = 0
        tokens_received = 0
        for delta in svc.stream_chat(req.message, req.history):
            token, retrieved, t_sent, t_received = delta
            full_answer.append(token)
            yield token
        answer = "".join(full_answer)
        tokens_sent += t_sent
        tokens_received += t_received
        db.add(CustomerSupportChatbotAI(
            question=req.message,
            answer=answer,
            context=retrieved,
            history=req.history,
            tokens_sent=tokens_sent,
            tokens_received=tokens_received
        ))
        db.commit()

    return StreamingResponse(token_generator(), media_type="text/plain")