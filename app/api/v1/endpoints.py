from fastapi import APIRouter, Depends, HTTPException
from fastapi import BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json
import re
from datetime import datetime
from app.models.db import init_db, SessionLocal
from app.models.db import CustomerSupportChatbotAI, SupportRequest
from app.schemas.api import (
    ChatRequest,
    ChatResponse,
    OperationResponse,
    RunDiscoveryRequest,
    SupportRequestCreate,
    SupportRequestResponse,
)
from app.services import svc
from app.services.rag_chatbot import RAGChatbot
from app.services.training.rag import RAGTrainer
from app.services.rag_chatbot.agent import Agent
from app.services.rag_chatbot.utils import extract_llm_token_usage
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


async def _open_ticket_generator(history_messages, history, req, db, theme, user_id, start_time):
    """Generate a ticket from conversation history without running the agent."""
    from app.services.rag_chatbot.utils import get_message_content, create_llm

    yield f'data: {{"node": "חושב..."}}\n\n'

    try:
        # Build conversation text from full history + current message
        conversation_parts = []
        for msg in history_messages:
            role = "User" if isinstance(msg, HumanMessage) else "Assistant"
            conversation_parts.append(f"{role}: {get_message_content(msg)}")
        if req.message.strip():
            conversation_parts.append(f"User: {req.message}")
        conversation_text = "\n".join(conversation_parts)

        ticket_prompt = f"""Based on the conversation below, generate a support ticket describing what the USER needs help with.

Conversation:
{conversation_text}

IMPORTANT INSTRUCTIONS:
- Focus ONLY on what the user asked about or needs help with. Do NOT summarize the assistant's answers.
- Extract the user's problem, question, or request — not the solution that was provided.
- The ticket must contain ONLY technical details. DO NOT include personal data (name, email, phone, company, subdomain).
- If the user asked multiple questions, focus on the main topic or the most recent unresolved question.

Generate a JSON object with exactly these fields in the same language as the user's messages:
- category: Maximum 3 words describing the ticket category
- title: A concise title summarizing what the user needs help with
- description: A short description of the user's problem or request (what they need, not what was answered)

Return ONLY valid JSON:
{{"category": "...", "title": "...", "description": "..."}}"""

        llm = create_llm(temperature=0.1)
        response = llm.invoke([HumanMessage(content=ticket_prompt)])
        ticket_json = response.content.strip()
        ticket_tokens_sent, ticket_tokens_received = extract_llm_token_usage(response)

        json_match = re.search(r'\{.*\}', ticket_json, re.DOTALL)
        if json_match:
            ticket_json = json_match.group(0)

        ticket_data = json.loads(ticket_json)
        if not all(key in ticket_data for key in ["category", "title", "description"]):
            raise ValueError("Missing required fields")

        category_words = ticket_data["category"].split()
        if len(category_words) > 3:
            ticket_data["category"] = " ".join(category_words[:3])

        yield f'data: {json.dumps({"output_type": "ticket", "category": ticket_data["category"], "title": ticket_data["title"], "description": ticket_data["description"]})}\n\n'

        # Save to DB
        answer = json.dumps(ticket_data, ensure_ascii=False)
        db.add(CustomerSupportChatbotAI(
            question=req.message or "[open_ticket]",
            answer=answer,
            context=json.dumps({}, ensure_ascii=False),
            history=json.dumps(history),
            tokens_sent=ticket_tokens_sent, tokens_received=ticket_tokens_received,
            session_id=req.session_id,
            theme=theme,
            duration=(datetime.now() - start_time).total_seconds(),
            user_id=user_id,
            date_asked=datetime.now(),
        ))
        db.commit()

    except Exception as e:
        logger.exception(f"Error in open_ticket: {e}")
        fallback = {"category": "Support Request", "title": "Customer Support Request", "description": "The user requested customer support assistance."}
        yield f'data: {json.dumps({"output_type": "ticket", **fallback})}\n\n'

    yield "data: {}\n\n"


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

    # --- Open ticket shortcut ---
    if req.open_ticket == 1:
        return StreamingResponse(
            _open_ticket_generator(history_messages, history, req, db, theme, user_id, start_time),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

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

                    # Extract metadata from agent (context + tokens)
                    agent_context = {}
                    agent_tokens_sent = 0
                    agent_tokens_received = 0
                    if isinstance(data, dict):
                        agent_context = data.get("bm25_raw_contexts", {})
                        agent_tokens_sent = data.get("total_tokens_sent", 0)
                        agent_tokens_received = data.get("total_tokens_received", 0)

                    # Save to database
                    db.add(
                        CustomerSupportChatbotAI(
                            question=req.message,
                            answer=answer,
                            context=json.dumps(agent_context, ensure_ascii=False),
                            history=json.dumps(history),
                            tokens_sent=agent_tokens_sent,
                            tokens_received=agent_tokens_received,
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


@router.get("/refresh_index", response_model=OperationResponse)
async def refresh_index(background: BackgroundTasks):
    """Rebuild BM25 index from current DB without running scrapers."""
    def _job():
        logger.info("refresh_index job started")
        db = SessionLocal()
        try:
            RAGTrainer(db, logger).run()
            rag_bot.reinitialize(db)
            invalidate_question_titles_cache()
            invalidate_knowledge_summary_cache()
            invalidate_bm25_retriever()
            logger.info("refresh_index job completed")
        except Exception as e:
            logger.exception(f"refresh_index job failed: {e}")
        finally:
            db.close()

    background.add_task(_job)
    return OperationResponse(amount_added=0)


@router.post("/run_discovery", response_model=OperationResponse)
async def run_discovery(req: RunDiscoveryRequest, background: BackgroundTasks):
    """Run selected discovery types and rebuild index."""
    valid_types = [t for t in req.types if t in ("cs", "pm", "yt")]
    if not valid_types:
        raise HTTPException(status_code=400, detail="No valid discovery types provided. Use: cs, pm, yt")

    def _job():
        logger.info(f"run_discovery job started for types: {valid_types}")
        db = SessionLocal()
        try:
            from app.services.svc import add_data_by_types
            add_data_by_types(db, logger, valid_types)
            rag_bot.reinitialize(db)
            invalidate_question_titles_cache()
            invalidate_knowledge_summary_cache()
            invalidate_bm25_retriever()
            logger.info("run_discovery job completed")
        except Exception as e:
            logger.exception(f"run_discovery job failed: {e}")
        finally:
            db.close()

    background.add_task(_job)
    return OperationResponse(amount_added=0)
