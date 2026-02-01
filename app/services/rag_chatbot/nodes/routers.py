"""Routing nodes for the LangGraph agent.

These nodes will eventually contain the high-level routing logic that decides
where the agent should go next. For now they simply pass the state through.
"""

from __future__ import annotations
from typing import Dict, Any, Optional
from langchain_core.messages import HumanMessage
from app.core.config import MODEL, settings
from app.models.db import SessionLocal, CustomerSupportChatbotData
from app.services.rag_chatbot.utils import (
    get_last_user_message,
    truncate_text_by_tokens,
    count_tokens_approximate,
    create_llm,
)
import logging

logger = logging.getLogger(__name__)

# Module-level cache for knowledge summary
_knowledge_summary_cache: Optional[str] = None


def invalidate_knowledge_summary_cache() -> None:
    """Invalidate the knowledge summary cache.
    
    Call this when the database is updated to ensure fresh data is loaded.
    """
    global _knowledge_summary_cache
    _knowledge_summary_cache = None
    logger.info("Knowledge summary cache invalidated")


def _get_knowledge_summary(logger: logging.Logger, db_session=None) -> str:
    """Generate a cached summary of all knowledge in the database.
    
    Queries all questions and answers from CustomerSupportChatbotData,
    sends them to an LLM to create a concise summary (max 1000 tokens),
    and caches the result.
    
    Args:
        logger: Logger instance
        db_session: Optional database session to reuse. If None, creates a new one.
    
    Returns:
        Summary string of the knowledge base
    """
    global _knowledge_summary_cache
    
    # Return cached value if available
    if _knowledge_summary_cache is not None:
        return _knowledge_summary_cache
    
    # Query database for all questions and answers
    should_close = False
    if db_session is None:
        db_session = SessionLocal()
        should_close = True

    try:
        db_items = db_session.query(
            CustomerSupportChatbotData.question,
            CustomerSupportChatbotData.answer
        ).filter(
            CustomerSupportChatbotData.question.isnot(None),
            CustomerSupportChatbotData.answer.isnot(None)
        ).all()
        
        if not db_items:
            logger.warning("No questions and answers found in database for summary generation")
            _knowledge_summary_cache = "No knowledge base content available."
            return _knowledge_summary_cache
        
        # Format Q&A pairs for the LLM
        qa_pairs = []
        for question, answer in db_items:
            if question and answer and question.strip() and answer.strip():
                qa_pairs.append(f"Q: {question.strip()}\nA: {answer.strip()}")
        
        if not qa_pairs:
            logger.warning("No valid Q&A pairs found after filtering")
            _knowledge_summary_cache = "No valid knowledge base content available."
            return _knowledge_summary_cache
        
        # Combine all Q&A pairs, but limit total input to avoid excessive tokens
        # Truncate each Q&A pair to 100 tokens max, and limit total pairs to 100
        max_pairs = 100
        max_pair_tokens = 100
        truncated_pairs = []
        for pair in qa_pairs[:max_pairs]:
            truncated_pair = truncate_text_by_tokens(pair, max_pair_tokens)
            truncated_pairs.append(truncated_pair)
        
        knowledge_text = "\n\n".join(truncated_pairs)
        if len(qa_pairs) > max_pairs:
            knowledge_text += f"\n\n[Note: {len(qa_pairs) - max_pairs} more Q&A pairs were truncated]"
        
        logger.info(f"Generating knowledge summary from {len(truncated_pairs)} Q&A pairs (of {len(qa_pairs)} total)...")
        
        # Create summary prompt (optimized for token efficiency)
        summary_prompt = f"""Summarize the knowledge base for a customer support chatbot.

Create a concise summary (max 500 tokens) covering:
- Main topics and features
- Key capabilities
- Important concepts
- Common use cases

Knowledge Base (sample):
{knowledge_text}

Provide a structured summary:"""

        # Use ChatOpenAI with max_tokens to limit output (reduced to 500 tokens)
        llm = create_llm(temperature=0.1)
        # Note: max_tokens is set via invoke parameters, not in constructor
        
        try:
            response = llm.invoke([HumanMessage(content=summary_prompt)])
            summary = response.content.strip()
            
            # Store in cache
            _knowledge_summary_cache = summary
            logger.info(f"Generated and cached knowledge summary ({len(summary)} characters)")
            return summary
        except Exception as e:
            logger.error(f"Error generating knowledge summary: {e}", exc_info=True)
            # Return a fallback message, but don't cache it so we can retry
            return "Knowledge base summary unavailable due to processing error."
            
    except Exception as e:
        logger.error(f"Error loading Q&A pairs from database: {e}", exc_info=True)
        # Return empty summary on error, but don't cache it so we can retry next time
        return "Knowledge base summary unavailable due to database error."
    finally:
        if should_close:
            db_session.close()


def build_ticket_or_start_router_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Router that can (re)start flow or trigger ticket creation.
    
    After the user receives the capability explanation message, this node analyzes
    their response to determine if they want to:
    - Open a ticket for customer support -> route to build_ticket
    - Send a different message (new question) -> route to think_node
    """
    # Get the latest user message (their response to the capability explanation)
    messages = state.get("history", [])
    if not messages:
        # Default to think_node if no messages
        return {"thinking_process": "think_node"}
    
    # Find the last HumanMessage (user's response)
    user_message = get_last_user_message(messages)
    
    if not user_message:
        # No user message found, default to think_node
        return {"thinking_process": "think_node"}
    
    # Use LLM to determine if user wants to open a ticket or send a different message
    llm = create_llm(temperature=0.1)  # Low temperature for consistent routing decisions
    
    # Optimize ticket routing prompt
    routing_prompt = f"""Route user response after capability explanation.

User: "{user_message}"

TICKET if: explicitly wants ticket, says "yes", uses "open ticket", "create ticket", "support ticket".
MESSAGE if: new ZebraCRM question, clarification, different message, not explicitly asking for ticket.

Respond: "ticket" or "message" (one word only)."""

    try:
        response = llm.invoke([HumanMessage(content=routing_prompt)])
        decision = response.content.strip().lower()
        
        # Route to build_ticket if user wants to open a ticket, think_node otherwise
        if "ticket" in decision.lower():
            return {"thinking_process": "build_ticket"}
        return {"thinking_process": "think_node"}
    except (ValueError, AttributeError) as e:
        # Recoverable error - invalid response format, default to think_node
        logger.warning(f"build_ticket_or_start_router_node: Invalid LLM response format: {e}, defaulting to think_node")
        return {"thinking_process": "think_node"}
    except Exception as e:
        # Fatal error - LLM API failure or other critical issue
        logger.error(f"build_ticket_or_start_router_node: Fatal error during routing: {e}", exc_info=True)
        # Default to think_node on error (assume they want to send a different message)
        return {"thinking_process": "think_node"}


