"""Retrieval, answering, and ticket-related nodes for the LangGraph agent."""

from __future__ import annotations
from typing import Dict, Any
from langchain_core.messages import AIMessage, HumanMessage
from app.services.rag_chatbot.utils import get_message_content, create_llm
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
    
    ticket_prompt = f"""Based on the conversation below, generate a support ticket with category, title, and description.

Conversation:
{conversation_text}

CRITICAL: The ticket must contain ONLY technical details and explanations about the issue. DO NOT include any personal data about the customer such as:
- Customer name
- Email address
- Phone number
- Company name
- Subdomain
- Any other personally identifiable information

Focus on:
- Technical issue description
- Steps the user tried
- Error messages (if any)
- Feature or area of the system affected
- Technical explanations

Generate a JSON object with exactly these fields:
- category: Maximum 3 words describing the ticket category in Hebrew.
- title: A concise title summarizing the issue in Hebrew (technical only, no personal data)
- description: A short, informative description of the problem in Hebrew (technical details only, no personal data). Keep it brief and focused on the user's problem. If there is not much detail available, remain with a short description rather than making it longer.

Return ONLY valid JSON, no other text:
{{"category": "...", "title": "...", "description": "..."}}"""
    
    ticket_llm = create_llm(temperature=0.1)
    
    try:
        response = ticket_llm.invoke([HumanMessage(content=ticket_prompt)])
        ticket_json = response.content.strip()
        
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
            "category": "בקשת תמיכה",
            "title": "בקשת תמיכת לקוחות",
            "description": "המשתמש ביקש סיוע מתמיכת לקוחות."
        }, ensure_ascii=False)
        state["output"] = ticket_json
        state["output_type"] = "ticket"
        state["thinking_process"] = "__end__"
    except Exception as e:
        # Fatal error - LLM API failure or other critical issue
        logger.error(f"build_ticket_node: Fatal error: {e}", exc_info=True)
        # Still provide fallback ticket but log the error
        ticket_json = json.dumps({
            "category": "בקשת תמיכה",
            "title": "בקשת תמיכת לקוחות",
            "description": "המשתמש ביקש סיוע מתמיכת לקוחות."
        }, ensure_ascii=False)
        state["output"] = ticket_json
        state["output_type"] = "ticket"
        state["thinking_process"] = "__end__"
    
    return state


def capability_explanation_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Explain what the agent can and cannot do (out of scope flow)."""
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

    messages = state.get("history", [])
    state["history"] = messages + [AIMessage(content=capability_message)]
    state["output_type"] = "text"
    state["output"] = capability_message
    state["thinking_process"] = "build_ticket_or_start"  # Route to ticket router
    
    return state
