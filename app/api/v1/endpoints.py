from fastapi import APIRouter, Depends
from fastapi import BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json
from app.models.db import init_db, SessionLocal
from app.models.db import CustomerSupportChatbotAI
from app.schemas.api import ChatRequest, ChatResponse, OperationResponse
from app.services import svc
from app.services.rag_chatbot import RAGChatbot
from app.services.training.rag import RAGTrainer
import logging

init_db()
def get_db() -> Session:
    """Get a database session generator for FastAPI dependency injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
logger = logging.getLogger("services")
router = APIRouter()

class SingletonBot:
    def __init__(self, db: Session | None) -> None:
        # Build the bot once at startup using a throwaway session
        if db is not None:
            RAGTrainer(db, logger).run()
            self.bot = RAGChatbot(logger, db)
            db.close()
        else:
            self.bot = None  # will be set on first use
    def reinitialize(self, db: Session) -> None:
        self.bot = RAGChatbot(logger, db)

rag_bot = SingletonBot(SessionLocal())

def get_bot() -> RAGChatbot:
    """FastAPI dependency to provide the singleton RAG bot."""
    # If for any reason it's not initialized, initialize now with a fresh session
    if getattr(rag_bot, "bot", None) is None:
        db = SessionLocal()
        try:
            rag_bot.bot = RAGChatbot(logger, db)
        finally:
            db.close()
    return rag_bot.bot

@router.get("/add_new_data", response_model=OperationResponse)
async def add_new_data(background: BackgroundTasks):
    # Run the heavy scraping/training in the background with its own DB session
    def _job():
        logger.info("Background add_new_data job started")
        db = SessionLocal()
        try:
            svc.add_data(db, logger)
            rag_bot.reinitialize(db)
            logger.info("Background add_new_data job completed successfully")
        except Exception as e:  # pragma: no cover
            logger.exception(f"Background add_new_data job failed: {e}")
        finally:
            db.close()

    background.add_task(_job)
    # Immediate acknowledgment; background task will handle the real work
    return OperationResponse(amount_added=0)


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db), bot: RAGChatbot = Depends(get_bot)):
    answer, retrieved, tokens_sent, tokens_received = svc.chat(bot, req.message, req.history)
    entry = CustomerSupportChatbotAI(question=req.message,
                                     answer=answer,
                                     context=retrieved,
                                     history=req.history,
                                     tokens_sent=tokens_sent,
                                     tokens_received=tokens_received,
                                     session_id=req.session_id)
    db.add(entry)
    db.commit()
    return ChatResponse(response=answer)

@router.post("/chat/stream", response_model=ChatResponse)
async def chat_stream(req: ChatRequest, db: Session = Depends(get_db), bot: RAGChatbot = Depends(get_bot)):
    async def token_generator():
        full_answer = []
        tokens_sent = 0
        tokens_received = 0
        retrieved = ""
        
        # Consume the generator and stream tokens
        async for delta in svc.stream_chat(bot, req.message, req.history):
            token, retrieved, t_sent, t_received = delta
            if token:  # Only process non-empty tokens
                full_answer.append(token)
                # Yield each token as a JSON object
                yield f"data: {{\"response\": {json.dumps(token)} }}\n\n"
            tokens_sent = t_sent
            tokens_received = t_received

        # After streaming is complete, save to database
        answer = "".join(full_answer)
        db.add(CustomerSupportChatbotAI(
            question=req.message,
            answer=answer,
            context=retrieved,
            history=req.history,
            tokens_sent=tokens_sent,
            tokens_received=tokens_received,
            session_id=req.session_id
        ))
        db.commit()
        # Send a final empty message to signal completion
        yield "data: {}\n\n"

    return StreamingResponse(
        token_generator(),
        media_type="text/event-stream",
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'  # Disable buffering for nginx
        }
    )