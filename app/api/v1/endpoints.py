from fastapi import APIRouter, Depends, HTTPException
from fastapi import BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json
from datetime import datetime
from app.models.db import init_db, SessionLocal
from app.models.db import CustomerSupportChatbotAI, SupportRequest, CustomerSupportChatbotData
from app.schemas.api import (
    ChatRequest,
    ChatResponse,
    OperationResponse,
    SupportRequestCreate,
    SupportRequestResponse,
    KnowledgeBaseItem,
    KnowledgeBaseListResponse,
    KnowledgeBaseUpsert,
)
from app.services import svc
from app.services.rag_chatbot import RAGChatbot
from app.services.training.rag import RAGTrainer
from app.services.rag_chatbot.agent import Agent
from app.services.rag_chatbot.nodes.planning import (
    invalidate_question_titles_cache,
    invalidate_bm25_retriever,
)
from app.services.rag_chatbot.nodes.routers import invalidate_knowledge_summary_cache
import logging
from langchain_core.messages import HumanMessage, AIMessage

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


def _extract_session_metadata(session_id: str) -> tuple[str | None, str | None]:
    """Split the session identifier into its theme and user components."""
    parts = session_id.split("_", 2)
    if len(parts) < 2:
        return None, None
    theme, user_id = parts[0], parts[1]
    return (theme or None), (user_id or None)


def normalize_keys(d: dict) -> dict:
    return {str(k): v for k, v in d.items()}


def _serialize_kb_item(item: CustomerSupportChatbotData) -> KnowledgeBaseItem:
    date_added = item.date_added.isoformat() if item.date_added else ""
    return KnowledgeBaseItem(
        id=item.id,
        url=item.url,
        type=item.type,
        question=item.question,
        answer=item.answer,
        categories=item.categories,
        date_added=date_added,
    )


def _refresh_rag_components(db: Session) -> None:
    """Refresh BM25 corpus and invalidate caches after KB updates."""
    RAGTrainer(db, logger).run()
    rag_bot.reinitialize(db)
    invalidate_question_titles_cache()
    invalidate_knowledge_summary_cache()
    invalidate_bm25_retriever()


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
agent = Agent(logger)

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
            # Invalidate caches after data update
            invalidate_question_titles_cache()
            invalidate_knowledge_summary_cache()
            invalidate_bm25_retriever()
            logger.info("Background add_new_data job completed successfully")
        except Exception as e:  # pragma: no cover
            logger.exception(f"Background add_new_data job failed: {e}")
        finally:
            db.close()

    background.add_task(_job)
    # Immediate acknowledgment; background task will handle the real work
    return OperationResponse(amount_added=0)


@router.get("/knowledge-base", response_model=KnowledgeBaseListResponse)
def list_knowledge_base(db: Session = Depends(get_db)):
    items = (
        db.query(CustomerSupportChatbotData)
        .order_by(CustomerSupportChatbotData.id.desc())
        .all()
    )
    return KnowledgeBaseListResponse(items=[_serialize_kb_item(item) for item in items])


@router.post("/knowledge-base", response_model=KnowledgeBaseItem)
def create_knowledge_base_item(
    payload: KnowledgeBaseUpsert, db: Session = Depends(get_db)
):
    question = (payload.question or "").strip()
    answer = (payload.answer or "").strip()
    if not question or not answer:
        raise HTTPException(
            status_code=400, detail="question and answer must not be empty"
        )

    url = (payload.url or "").strip()
    if not url:
        url = "manual-entry"

    categories = [c.strip() for c in (payload.categories or []) if c and c.strip()]
    item = CustomerSupportChatbotData(
        question=question,
        answer=answer,
        url=url,
        type="manual",
        categories=categories or None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    _refresh_rag_components(db)
    return _serialize_kb_item(item)


@router.put("/knowledge-base/{item_id}", response_model=KnowledgeBaseItem)
def update_knowledge_base_item(
    item_id: int, payload: KnowledgeBaseUpsert, db: Session = Depends(get_db)
):
    item = (
        db.query(CustomerSupportChatbotData)
        .filter(CustomerSupportChatbotData.id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge base item not found")

    question = (payload.question or "").strip()
    answer = (payload.answer or "").strip()
    if not question or not answer:
        raise HTTPException(
            status_code=400, detail="question and answer must not be empty"
        )

    url = (payload.url or "").strip()
    if not url:
        url = "manual-entry"

    categories = [c.strip() for c in (payload.categories or []) if c and c.strip()]
    item.question = question
    item.answer = answer
    item.url = url
    item.categories = categories or None
    db.commit()
    db.refresh(item)
    _refresh_rag_components(db)
    return _serialize_kb_item(item)


def _build_history(db: Session, session_id: str) -> list[str]:
    """Build conversation history as a list of strings.
    
    Returns a list where each element is a message string, alternating between
    user messages and assistant messages.
    """
    row = (
        db.query(CustomerSupportChatbotAI)
        .filter(CustomerSupportChatbotAI.session_id == session_id)
        .order_by(CustomerSupportChatbotAI.id.desc())
        .first()
    )
    history = []
    if row:
        try:
            history = json.loads(row.history) if row.history else []
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse history JSON: {e}")
            history = []
        # Add the question and answer from this row
        if row.question:
            history.append(row.question)
        if row.answer:
            history.append(row.answer)
    return history


def _build_history_agent(db: Session, session_id: str) -> list:
    """Build history messages for agent as BaseMessage objects.
    
    Reuses _build_history and converts the string list to BaseMessage objects.
    
    Returns:
        List of BaseMessage objects (HumanMessage and AIMessage)
    """
    history_strings = _build_history(db, session_id)
    messages = []
    
    # Convert string history to BaseMessage objects
    # History alternates: user, assistant, user, assistant, ...
    for i in range(0, len(history_strings) - 1, 2):
        if i + 1 < len(history_strings):
            messages.append(HumanMessage(content=history_strings[i]))
            messages.append(AIMessage(content=history_strings[i + 1]))
        else:
            # Odd number of messages - last one is user message
            messages.append(HumanMessage(content=history_strings[i]))
    
    return messages

@router.post("/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest, db: Session = Depends(get_db), bot: RAGChatbot = Depends(get_bot)
):
    start_time = datetime.now()
    history = _build_history(db, req.session_id)
    answer, retrieved, tokens_sent, tokens_received = bot.chat(req.message, history)
    theme, user_id = _extract_session_metadata(req.session_id)
    duration = (datetime.now() - start_time).total_seconds()
    entry = CustomerSupportChatbotAI(
        question=req.message,
        answer=answer,
        context=json.dumps(normalize_keys(retrieved), ensure_ascii=False),
        history=json.dumps(history),
        tokens_sent=tokens_sent,
        tokens_received=tokens_received,
        session_id=req.session_id,
        theme=theme,
        duration=duration,
        user_id=user_id,
        date_asked=datetime.now(),
    )
    db.add(entry)
    db.commit()
    return ChatResponse(response=answer)


@router.post("/open_support_request", response_model=SupportRequestResponse)
def open_support_request(req: SupportRequestCreate, db: Session = Depends(get_db)):
    theme, user_id = _extract_session_metadata(req.session_id)
    support_request = SupportRequest(
        session_id=req.session_id, theme=theme, user_id=user_id
    )
    db.add(support_request)
    db.commit()
    db.refresh(support_request)
    return SupportRequestResponse(
        id=support_request.id,
        session_id=support_request.session_id,
        theme=support_request.theme,
        user_id=support_request.user_id,
        date_added=datetime.now(),
    )


@router.post("/chat/stream", response_model=ChatResponse)
async def chat_stream(
    req: ChatRequest, db: Session = Depends(get_db), bot: RAGChatbot = Depends(get_bot)
):
    start_time = datetime.now()
    history = _build_history(db, req.session_id)
    theme, user_id = _extract_session_metadata(req.session_id)

    async def token_generator():
        full_answer = []
        tokens_sent = 0
        tokens_received = 0
        retrieved = ""

        # Consume the generator and stream tokens
        async for delta in bot.stream_chat(req.message, history):
            token, retrieved, t_sent, t_received = delta
            if token:  # Only process non-empty tokens
                full_answer.append(token)
                # Yield each token as a JSON object
                yield f'data: {{"response": {json.dumps(token)} }}\n\n'
            tokens_sent = t_sent
            tokens_received = t_received

        # After streaming is complete, save to database
        answer = "".join(full_answer)
        db.add(
            CustomerSupportChatbotAI(
                question=req.message,
                answer=answer,
                context=json.dumps(normalize_keys(retrieved), ensure_ascii=False),
                history=json.dumps(history),
                tokens_sent=tokens_sent,
                tokens_received=tokens_received,
                session_id=req.session_id,
                theme=theme,
                duration=(datetime.now() - start_time).total_seconds(),
                user_id=user_id,
                date_asked=datetime.now(),
            )
        )
        db.commit()
        # Send a final empty message to signal completion
        yield "data: {}\n\n"

    return StreamingResponse(
        token_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable buffering for nginx
        },
    )


@router.post("/chat/agent")
async def agent_stream(req: ChatRequest, db: Session = Depends(get_db)):
    """Stream LangGraph agent execution with node transitions and response tokens.
    
    The agent receives history as input but doesn't manage it internally.
    History is passed directly from the database, similar to the /chat endpoint.
    """
    start_time = datetime.now()
    # Build history messages (without current message - agent.stream will add it)
    history_messages = _build_history_agent(db, req.session_id)
    # Convert message objects to strings for history serialization
    history = []
    for msg in history_messages:
        if hasattr(msg, 'content'):
            history.append(msg.content)
        else:
            history.append(str(msg))
    theme, user_id = _extract_session_metadata(req.session_id)

    async def event_generator():
        full_answer = []
        think_node_count = 0
        THINK_NODE_MESSAGES = ["אוסף מידע...", "חושב...", "לומד..."]

        # Immediately emit "חושב.." when input is received
        yield f'data: {{"node": "חושב..."}}\n\n'

        try:
            # Pass history (without current message) to agent
            async for event_type, data in agent.stream(
                req.message,
                history=history_messages,
                thread_id=req.session_id,
            ):
                if event_type == "node":
                    if data == "think_node":
                        message = THINK_NODE_MESSAGES[think_node_count % len(THINK_NODE_MESSAGES)]
                        think_node_count += 1
                        yield f'data: {{"node": {json.dumps(message)} }}\n\n'
                    # All other nodes: do not yield anything to the user
                elif event_type == "tool":
                    # Do not stream tool events to client
                    pass
                elif event_type == "output":
                    # Emit response token
                    if data:
                        if isinstance(data, dict) and data.get("output_type") == "text":
                            full_answer.append(data["token"])
                        yield f'data: {json.dumps(data)}\n\n'
                elif event_type == "done":
                    # After response is complete, save to database
                    answer = "".join(full_answer)
                    
                    # Save to database (no summary management)
                    db.add(
                        CustomerSupportChatbotAI(
                            question=req.message,
                            answer=answer,
                            context=json.dumps({}, ensure_ascii=False),
                            history=json.dumps(history),
                            tokens_sent=0,
                            tokens_received=0,
                            session_id=req.session_id,
                            theme=theme,
                            duration=(datetime.now() - start_time).total_seconds(),
                            user_id=user_id,
                            date_asked=datetime.now(),
                        )
                    )
                    
                    db.commit()
                    # Send final completion message
                    yield "data: {}\n\n"
        except Exception as e:
            logger.exception(f"Error in agent stream: {e}")
            yield f'data: {{"error": {json.dumps(str(e))} }}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
