"""Retrieval, answering, and ticket-related nodes for the LangGraph agent."""

from __future__ import annotations
from typing import Dict, Any
from langchain_core.messages import AIMessage, HumanMessage
from app.services.rag_chatbot.utils import get_message_content, create_llm, extract_llm_token_usage, sanitize_response_language
from app.services.rag_chatbot.prompt_resolver import resolve_prompt
import json
import logging
import re

logger = logging.getLogger(__name__)


def build_ticket_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Build a structured ticket based on the conversation so far.
    
    Uses the same logic as build_ticket_tool_func in think_node to ensure consistency.
    If ticket is already in state (from think_node), returns it unchanged.
    Otherwise, builds a new ticket from conversation history.
    """
    # If ticket already exists in state (from think_node's build_ticket_tool), return as-is
    if state.get("output_type") == "ticket" and state.get("output"):
        return state
    
    # Otherwise, build ticket from conversation history
    messages = state.get("history", [])
    
    # Build prompt to extract problem and generate ticket
    conversation_text = "\n".join([
        f"{'User' if isinstance(msg, HumanMessage) else 'Assistant'}: {get_message_content(msg)}"
        for msg in messages
    ])
    
    ticket_prompt = f"""Based on the conversation below, generate a support ticket describing what the USER needs help with.

Conversation:
{conversation_text}

IMPORTANT INSTRUCTIONS:
- Focus ONLY on what the user asked about or needs help with. Do NOT summarize the assistant's answers.
- Extract the user's problem, question, or request — not the solution that was provided.
- DO NOT include personal data (name, email, phone, company, subdomain).
- If the user asked multiple questions, focus on the main topic or the most recent unresolved question.

Generate a JSON object with exactly these fields in the same language as the user's messages in the conversation:
- category: Maximum 3 words describing the ticket category
- title: A concise title summarizing what the user needs help with (no personal data)
- description: A short description of the user's problem or request (what they need, not what was answered). Keep it brief. If there is not much detail available, remain with a short description rather than making it longer.

Return ONLY valid JSON, no other text:
{{"category": "...", "title": "...", "description": "..."}}"""
    
    ticket_llm = create_llm(temperature=0.1)
    
    try:
        response = ticket_llm.invoke([HumanMessage(content=ticket_prompt)])
        ticket_json = response.content.strip()

        # Accumulate token usage
        sent, received = extract_llm_token_usage(response)
        state["total_tokens_sent"] = state.get("total_tokens_sent", 0) + sent
        state["total_tokens_received"] = state.get("total_tokens_received", 0) + received

        # Try to extract JSON from response (in case LLM adds extra text)
        json_match = re.search(r'\{.*\}', ticket_json, re.DOTALL)
        if json_match:
            ticket_json = json_match.group(0)
        
        # Try to parse and validate JSON
        ticket_data = json.loads(ticket_json)
        if not all(key in ticket_data for key in ["category", "title", "description"]):
            raise ValueError("Missing required fields")
        
        # Ensure category is max 3 words
        category_words = ticket_data["category"].split()
        if len(category_words) > 3:
            ticket_data["category"] = " ".join(category_words[:3])

        for key in ("category", "title", "description"):
            if key in ticket_data:
                ticket_data[key] = sanitize_response_language(ticket_data[key])

        ticket_json = json.dumps(ticket_data, ensure_ascii=False)
        
        # Update state with ticket
        state["output"] = ticket_json
        state["output_type"] = "ticket"
        state["thinking_process"] = "__end__"
        
        # Add AI message to history
        messages = state.get("history", [])
        state["history"] = messages + [AIMessage(content=f"Support ticket created: {ticket_json}")]
        
    except (json.JSONDecodeError, ValueError) as e:
        # Recoverable error - JSON parsing failed, use fallback
        logger.warning(f"build_ticket_node: JSON parsing error: {e}, using fallback")
        ticket_json = json.dumps({
            "category": "Support Request",
            "title": "Customer Support Request",
            "description": "The user requested customer support assistance."
        }, ensure_ascii=False)
        state["output"] = ticket_json
        state["output_type"] = "ticket"
        state["thinking_process"] = "__end__"
    except Exception as e:
        # Fatal error - LLM API failure or other critical issue
        logger.error(f"build_ticket_node: Fatal error: {e}", exc_info=True)
        # Still provide fallback ticket but log the error
        ticket_json = json.dumps({
            "category": "Support Request",
            "title": "Customer Support Request",
            "description": "The user requested customer support assistance."
        }, ensure_ascii=False)
        state["output"] = ticket_json
        state["output_type"] = "ticket"
        state["thinking_process"] = "__end__"
    
    return state


def capability_explanation_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Explain what the agent can and cannot do (out of scope flow).

    Uses LLM to generate the message in the same language as the user.
    """
    messages = state.get("history", [])

    llm = create_llm(temperature=0.1)

    # Build conversation context so LLM can detect language
    conversation_text = "\n".join([
        f"{'User' if isinstance(msg, HumanMessage) else 'Assistant'}: {get_message_content(msg)}"
        for msg in messages[-4:]
    ])

    is_test = state.get("is_test", False)
    db_prompt = resolve_prompt("capability_explanation", is_test_session=is_test)
    if db_prompt is not None:
        prompt = db_prompt.format(conversation_text=conversation_text)
    else:
        prompt = f"""Based on the conversation below, generate a capability explanation message for a ZebraCRM customer support bot.

Conversation:
{conversation_text}

IMPORTANT: Write the message in the SAME language as the user's messages.

The message should explain:
- You help with ZebraCRM customer support (questions about the system, features, troubleshooting, support)
- You can answer questions about ZebraCRM features and products
- You can help with issues and troubleshooting
- You don't have access to personal data or the user's specific account
- If their question isn't related to ZebraCRM, you probably can't help
- They can ask a ZebraCRM-related question or request to open a support ticket

Keep it concise with bullet points. Return ONLY the message text."""

    try:
        response = llm.invoke([HumanMessage(content=prompt)])
        capability_message = sanitize_response_language(response.content.strip())

        # Accumulate token usage
        sent, received = extract_llm_token_usage(response)
        state["total_tokens_sent"] = state.get("total_tokens_sent", 0) + sent
        state["total_tokens_received"] = state.get("total_tokens_received", 0) + received
    except Exception:
        # Fallback to Hebrew (original behavior)
        capability_message = """אני כאן כדי לעזור בתמיכת לקוחות של זברה.

אני יכול/ה:
• לענות על שאלות על המערכת והפיצ'רים של זברה
• לעזור בבעיות ותקלות
• להסביר על מוצרים ושירותים של זברה
• לעזור בשימוש נכון ובתהליכי עבודה במערכת

חשוב לדעת:
• אין לי גישה לנתונים אישיים או לחשבון הספציפי שלך במערכות זברה
• אני לא רואה פרטים מזהים, נתוני לקוח, או מידע רגיש בזמן אמת

אם השאלה שלך לא קשורה לזברה – כנראה שלא אוכל לעזור.

כדי להמשיך:
• שאל/י שאלה שקשורה לזברה
• או כתוב/י שברצונך לפתוח פנייה לתמיכה"""

    state["history"] = messages + [AIMessage(content=capability_message)]
    state["output_type"] = "text"
    state["output"] = capability_message
    state["thinking_process"] = "build_ticket_or_start"
    return state
