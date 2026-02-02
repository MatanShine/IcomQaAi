"""Planning node for the LangGraph agent - single node with tool calling."""

from __future__ import annotations
from typing import Dict, Any, List, Optional
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from app.models.db import SessionLocal, CustomerSupportChatbotData
from app.core.config import settings, MODEL
from app.services.rag_chatbot.retriever import BM25Retriever
from app.services.rag_chatbot.utils import (
    get_last_user_message,
    get_message_content,
    create_llm,
)
import json
import logging
import re

logger = logging.getLogger(__name__)

# Module-level cache for question titles
_question_titles_cache: Optional[List[str]] = None

# Module-level singleton BM25Retriever
_shared_retriever: Optional[BM25Retriever] = None


def invalidate_question_titles_cache() -> None:
    """Invalidate the question titles cache.
    
    Call this when the database is updated to ensure fresh data is loaded.
    """
    global _question_titles_cache
    _question_titles_cache = None
    logger.info("Question titles cache invalidated")


def invalidate_bm25_retriever() -> None:
    """Invalidate the shared BM25 retriever instance.
    
    Call this when the BM25 index or database content changes.
    """
    global _shared_retriever
    _shared_retriever = None
    logger.info("Shared BM25 retriever invalidated")


def _get_all_question_titles(logger: logging.Logger, db_session=None) -> List[str]:
    """Get all question titles from the database, using a module-level cache.
    
    Args:
        logger: Logger instance
        db_session: Optional database session to reuse. If None, creates a new one.
    
    Returns:
        List of question title strings (non-null questions only)
    """
    global _question_titles_cache
    
    # Return cached value if available
    if _question_titles_cache is not None:
        return _question_titles_cache
    
    # Query database for all question titles
    should_close = False
    if db_session is None:
        db_session = SessionLocal()
        should_close = True

    try:
        db_items = db_session.query(CustomerSupportChatbotData.question).filter(
            CustomerSupportChatbotData.question.isnot(None)
        ).all()
        
        # Extract question strings from tuples and filter out empty strings
        question_titles = [
            item[0].strip() 
            for item in db_items 
            if item[0] and item[0].strip()
        ]
        
        # Store in cache
        _question_titles_cache = question_titles
        logger.info(f"Loaded {len(question_titles)} question titles from database and cached them.")
        return question_titles
    except Exception as e:
        logger.error(f"Error loading question titles from database: {e}", exc_info=True)
        # Return empty list on error, but don't cache it so we can retry next time
        return []
    finally:
        if should_close:
            db_session.close()


def _get_shared_retriever(logger: logging.Logger, db_session=None) -> BM25Retriever:
    """Get or create the shared BM25Retriever instance.
    
    Args:
        logger: Logger instance
        db_session: Optional database session. If None, creates a temporary one for initialization.
    """
    global _shared_retriever
    
    if _shared_retriever is None:
        # Initialize with a temporary session if none provided
        if db_session is None:
            db_session = SessionLocal()
            should_close = True
        else:
            should_close = False
        
        try:
            _shared_retriever = BM25Retriever(logger, db_session, settings.index_file, top_k=5)
            logger.info("Initialized shared BM25Retriever instance")
        finally:
            if should_close:
                db_session.close()
    
    return _shared_retriever


def _is_question_related_to_zebracrm(user_message: str, bm25_results: List[str]) -> bool:
    """Check if a question is related to ZebraCRM.
    
    Args:
        user_message: The user's question
        bm25_results: List of BM25 search results (formatted as <data_N>...</data_N>)
    
    Returns:
        True if the question is related to ZebraCRM, False otherwise
    """
    user_lower = user_message.lower()
    
    # Check if BM25 search returned relevant results (not just "No results found")
    has_relevant_results = False
    if bm25_results:
        for result in bm25_results:
            if result and "<data_1>No results found</data_1>" not in result:
                # Check if any result contains actual content
                if any(f"<data_{i}>" in result and "</data_{i}>" in result for i in range(1, 6)):
                    has_relevant_results = True
                    break
    
    # Check if question explicitly mentions ZebraCRM/CRM/system-related terms
    crm_keywords = [
        "zebra", "crm", "system", "מערכת", "זברה",
        "feature", "פיצ'ר", "תכונה",
        "support", "תמיכה", "עזרה",
        "troubleshoot", "תקלה", "בעיה",
        "how to", "איך", "כיצד",
        "manage", "ניהול", "לנהל",
        "create", "יצירה", "ליצור",
        "edit", "עריכה", "לערוך",
        "delete", "מחיקה", "למחוק",
        "report", "דוח", "דוחות",
        "contact", "איש קשר", "לקוח",
        "deal", "עסקה", "עסקאות",
        "pipeline", "צינור", "תהליך",
        "workflow", "תהליך עבודה",
    ]
    
    mentions_crm_terms = any(keyword in user_lower for keyword in crm_keywords)
    
    # Question is related if:
    # 1. BM25 found relevant results (indicates ZebraCRM content exists), OR
    # 2. Question explicitly mentions CRM-related terms
    is_related = has_relevant_results or mentions_crm_terms
    
    logger.info(f"_is_question_related_to_zebracrm: has_relevant_results={has_relevant_results}, mentions_crm_terms={mentions_crm_terms}, is_related={is_related}")
    
    return is_related


def think_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Single controller node that uses GPT-5 tool calling to decide actions.
    
    Tools:
    - bm25: Search knowledge base (max 5 times per user input)
    - mcq: Ask multiple choice question (max 1 time per user input)
    - final_answer: Provide final answer to user (max 1 time per user input)
    - capability_explanation: Explain capabilities and route to ticket (max 1 time per user input)
    - build_ticket: Build support ticket when problem is known but unsolved, user requests support contact, or agent couldn't solve issue (max 1 time per user input)
    """
    messages: List[Any] = state.get("history", [])
    # Use setdefault to initialize and get in one operation
    tool_counts: Dict[str, int] = state.setdefault("tool_counts", {"bm25": 0, "mcq": 0, "final_answer": 0, "capability_explanation": 0})
    bm25_results: List[str] = state.setdefault("bm25_results", [])
    
    # Initialize other state defaults
    state.setdefault("output", "")
    state.setdefault("output_type", "")
    
    # Get user's current message
    user_message = get_last_user_message(messages) or ""
    
    # Get question titles for context
    question_titles = _get_all_question_titles(logger)
    question_titles_text = ""
    if question_titles:
        limited_titles = question_titles[:50]
        question_titles_list = "\n".join([f"{i+1}. {title}" for i, title in enumerate(limited_titles)])
        if len(question_titles) > 50:
            question_titles_text = f"""
Available Questions in Knowledge Base (showing top 50 of {len(question_titles)}):
{question_titles_list}
"""
        else:
            question_titles_text = f"""
Available Questions in Knowledge Base:
{question_titles_list}
"""
    
    # Build system prompt
    system_prompt = f"""You are a customer support assistant for ZebraCRM.

CRITICAL SCOPE DEFINITION:
You ONLY answer questions about ZebraCRM (the CRM system, its features, troubleshooting, support, and how to use ZebraCRM for business operations). 

You MUST use capability_explanation_tool for questions that are:
- Completely unrelated to ZebraCRM (e.g., weather, cooking, unrelated products, general knowledge)
- Not about CRM functionality, features, or support
- Not found in the knowledge base after searching AND clearly not about using ZebraCRM

IMPORTANT: Business domain terminology is acceptable IF the question relates to using ZebraCRM features. For example:
- "How do I manage restaurant orders in ZebraCRM?" - RELATED (about using ZebraCRM)
- "How do I cook pasta?" - UNRELATED (use capability_explanation_tool)
- "How do I track inventory?" - RELATED if about ZebraCRM features, UNRELATED if general inventory management

If the question is unrelated to ZebraCRM, you MUST use capability_explanation_tool immediately. Do NOT use final_answer_tool for unrelated questions.

{question_titles_text}

You have access to the following tools:
1. bm25_tool: Search the knowledge base with a query. Returns up to 5 results formatted as <data_1>...</data_1>...<data_5>...</data_5>
2. mcq_tool: Ask a multiple choice question to clarify user needs. Provide a 'question' (what to ask the user) and 'search_query' (keywords to find relevant options). The tool will automatically search the knowledge base and present options from existing data.
3. final_answer_tool: Provide the final answer to the user's question. ONLY use this for ZebraCRM-related questions that you can answer.
4. capability_explanation_tool: Explain what you can and cannot do. Use this for questions completely unrelated to ZebraCRM. You MUST use this tool when the question is not about ZebraCRM.
5. build_ticket_tool: Build a support ticket when user explicitly requests a ticket (e.g., "פנייה", "לפתוח פנייה", "אפשר פנייה", "open ticket") OR when you know the user's problem but couldn't solve it OR user asks for customer support contact

IMPORTANT: When the user explicitly asks to open a ticket (e.g., "פנייה", "לפתוח פנייה", "אפשר פנייה"), you MUST use build_ticket_tool immediately. Do NOT use final_answer_tool for ticket requests.

Tool limits per user input:
- bm25_tool: maximum 5 times
- mcq_tool: maximum 1 time
- final_answer_tool: maximum 1 time
- capability_explanation_tool: maximum 1 time
- build_ticket_tool: ALWAYS available (not counted in tool limits), maximum 1 time per user input

Current tool usage: bm25={tool_counts.get("bm25", 0)}/5, mcq={tool_counts.get("mcq", 0)}/1, final_answer={tool_counts.get("final_answer", 0)}/1, capability_explanation={tool_counts.get("capability_explanation", 0)}/1

Note: build_ticket_tool and final_answer_tool are always available regardless of other tool limits.

BM25 Results so far:
{chr(10).join(bm25_results) if bm25_results else "None yet"}

Use tools strategically to gather information before providing a final answer. If after searching you determine the question is unrelated to ZebraCRM, use capability_explanation_tool."""

    # Create LLM with tool definitions
    llm = create_llm(temperature=0.1)
    
    # Define tool schemas using Pydantic
    class BM25ToolInput(BaseModel):
        query: str = Field(description="The search query to find relevant information")
    
    class MCQToolInput(BaseModel):
        question: str = Field(description="The multiple choice question to ask the user to clarify their needs")
        search_query: str = Field(description="A search query to find relevant answer options from the knowledge base")
    
    class FinalAnswerToolInput(BaseModel):
        answer: str = Field(description="The final answer to provide to the user")
    
    class CapabilityExplanationToolInput(BaseModel):
        pass
    
    class BuildTicketToolInput(BaseModel):
        pass  # No input needed - LLM generates from conversation context
    
    # Create tool functions
    def bm25_tool_func(query: str) -> str:
        """Search the knowledge base with a query. Returns up to 5 results."""
        retriever = _get_shared_retriever(logger)
        try:
            contexts = retriever.retrieve_contexts(query, history=[])
        except (AttributeError, ValueError) as e:
            # Recoverable error - retriever state issue
            logger.warning(f"bm25_tool: Retriever error: {e}")
            contexts = {}
        except Exception as e:
            # Fatal error - unexpected failure
            logger.error(f"bm25_tool: Unexpected error: {e}", exc_info=True)
            contexts = {}
        
        formatted_results = []
        if contexts:
            for idx, (q, a, url) in enumerate(contexts.values(), 1):
                formatted_results.append(f"<data_{idx}>\nQuestion: {q}\nAnswer: {a}\n</data_{idx}>")
        else:
            formatted_results.append("<data_1>No results found</data_1>")
        
        return "\n".join(formatted_results)
    
    def mcq_tool_func(question: str, search_query: str) -> str:
        """Ask a multiple choice question to clarify user needs.
        
        Uses BM25 search to find relevant answer options from the knowledge base,
        ensuring all MCQ options point to existing data.
        """
        retriever = _get_shared_retriever(logger)
        try:
            # Search for relevant content using the search query
            contexts = retriever.retrieve_contexts(search_query, history=[])
        except (AttributeError, ValueError) as e:
            # Recoverable error - retriever state issue
            logger.warning(f"mcq_tool: Retriever error: {e}")
            contexts = {}
        except Exception as e:
            # Fatal error - unexpected failure
            logger.error(f"mcq_tool: Unexpected BM25 search error: {e}", exc_info=True)
            contexts = {}
        
        # Extract unique question titles from search results as MCQ options
        answers = []
        seen_questions = set()
        if contexts:
            for q, a, url in contexts.values():
                # Use the question title as the MCQ option
                if q and q.strip() and q.strip() not in seen_questions:
                    answers.append(q.strip())
                    seen_questions.add(q.strip())
                    if len(answers) >= 3:  # Limit to 3 options maximum
                        break
        
        # If no results found, use fallback question titles from cache
        if not answers:
            all_titles = _get_all_question_titles(logger)
            # Use first 3 titles as fallback
            answers = all_titles[:3] if all_titles else ["לא נמצאו תוצאות רלוונטיות"]
        
        # Ensure maximum 3 answers (safeguard)
        answers = answers[:3]
        
        logger.info(f"mcq_tool: Generated {len(answers)} options from DB for question: {question}")
        return f"<question>{question}</question><answers>{json.dumps(answers, ensure_ascii=False)}</answers>"
    
    def final_answer_tool_func(answer: str) -> str:
        """Provide the final answer to the user's question."""
        return answer
    
    def capability_explanation_tool_func() -> str:
        """Explain what the assistant can and cannot do."""
        return "capability_explanation"
    
    def build_ticket_tool_func() -> str:
        """Build a support ticket with category, title, and description based on conversation history."""
        # Use conversation history to generate ticket
        # Single LLM call to generate all 3 fields in JSON format
        ticket_llm = create_llm(temperature=0.1)
        
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
        
        try:
            response = ticket_llm.invoke([HumanMessage(content=ticket_prompt)])
            ticket_json = response.content.strip()
            
            # Try to extract JSON from response (in case LLM adds extra text)
            # Find JSON object boundaries
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
            
            return json.dumps(ticket_data, ensure_ascii=False)
        except Exception as e:
            logger.error(f"build_ticket_tool error: {e}", exc_info=True)
            # Fallback ticket in Hebrew
            return json.dumps({
                "category": "בקשת תמיכה",
                "title": "בקשת תמיכת לקוחות",
                "description": "המשתמש ביקש סיוע מתמיכת לקוחות."
            }, ensure_ascii=False)
    
    # Create StructuredTool objects
    tools = [
        StructuredTool.from_function(
            func=bm25_tool_func,
            name="bm25_tool",
            description="Search the knowledge base with a query. Returns up to 5 results formatted as <data_1>...</data_1>...<data_5>...</data_5>",
            args_schema=BM25ToolInput,
        ),
        StructuredTool.from_function(
            func=mcq_tool_func,
            name="mcq_tool",
            description="Ask a multiple choice question to clarify user needs. Provide a question and a search_query - the tool will search the knowledge base and return relevant options from existing data. Can only be used once per user input.",
            args_schema=MCQToolInput,
        ),
        StructuredTool.from_function(
            func=final_answer_tool_func,
            name="final_answer_tool",
            description="Provide the final answer to the user's question. ONLY use this for ZebraCRM-related questions that you can answer based on the knowledge base or conversation context. Do NOT use this for questions unrelated to ZebraCRM. Can only be used once per user input.",
            args_schema=FinalAnswerToolInput,
        ),
        StructuredTool.from_function(
            func=capability_explanation_tool_func,
            name="capability_explanation_tool",
            description="Explain what the assistant can and cannot do. Use this for questions completely unrelated to ZebraCRM (e.g., weather, cooking, unrelated products, general knowledge not about CRM). You MUST use this tool when the question is not about ZebraCRM, its features, troubleshooting, or support. Can only be used once per user input.",
            args_schema=CapabilityExplanationToolInput,
        ),
        StructuredTool.from_function(
            func=build_ticket_tool_func,
            name="build_ticket_tool",
            description="Build a support ticket when: 1) user explicitly requests to open a ticket (e.g., 'פנייה', 'לפתוח פנייה', 'אפשר פנייה', 'open ticket', 'create ticket'), 2) agent knows the user's problem but couldn't solve it, 3) user asks for customer support phone number or asks support to call them, 4) agent couldn't solve the issue. This tool is ALWAYS available regardless of other tool limits. Can only be used once per user input.",
            args_schema=BuildTicketToolInput,
        ),
    ]
    
    # Bind tools to LLM
    llm_with_tools = llm.bind_tools(tools)
    
    # Prepare messages for LLM (include system prompt as first message)
    llm_messages = [HumanMessage(content=system_prompt)] + messages
    
    try:
        # Invoke LLM with tool calling
        response = llm_with_tools.invoke(llm_messages)
        
        # Check if LLM wants to call a tool
        if hasattr(response, 'tool_calls') and response.tool_calls:
            tool_call = response.tool_calls[0]  # Handle first tool call
            tool_name = tool_call.get("name") or tool_call.get("function", {}).get("name", "")
            tool_args_raw = tool_call.get("args") or tool_call.get("function", {}).get("arguments", "{}")
            
            # Parse tool args if string
            if isinstance(tool_args_raw, str):
                try:
                    tool_args = json.loads(tool_args_raw)
                except json.JSONDecodeError as e:
                    logger.warning(f"think_node: Failed to parse tool args JSON: {e}, using empty dict")
                    tool_args = {}
            else:
                tool_args = tool_args_raw or {}
            
            # Enforce tool limits
            if tool_name == "bm25_tool" and tool_counts.get("bm25", 0) >= 5:
                logger.warning("bm25_tool limit reached (5)")
                # Check if question is related before forcing final_answer
                if not _is_question_related_to_zebracrm(user_message, bm25_results):
                    logger.warning("bm25_tool limit reached but question is unrelated, using capability_explanation_tool")
                    if tool_counts.get("capability_explanation", 0) < 1:
                        tool_name = "capability_explanation_tool"
                        tool_args = {}
                    else:
                        # Already used capability_explanation, provide fallback message in Hebrew
                        tool_name = "final_answer_tool"
                        tool_args = {"answer": "אני יכול לעזור רק בשאלות הקשורות לזברה. אנא שאל אותי על תכונות זברה, פתרון בעיות או תמיכה."}
                else:
                    tool_name = "final_answer_tool"
                    tool_args = {"answer": "I've searched extensively but couldn't find specific information. Could you provide more details or rephrase your question?"}
            elif tool_name == "mcq_tool" and tool_counts.get("mcq", 0) >= 1:
                logger.warning("mcq_tool limit reached (1), forcing final_answer")
                tool_name = "final_answer_tool"
                tool_args = {"answer": "Based on the information I have, let me provide you with an answer."}
            elif tool_name == "final_answer_tool" and tool_counts.get("final_answer", 0) >= 1:
                logger.warning("final_answer_tool already used, ending")
                state["thinking_process"] = "__end__"
                return state
            elif tool_name == "capability_explanation_tool" and tool_counts.get("capability_explanation", 0) >= 1:
                logger.warning("capability_explanation_tool already used, forcing final_answer")
                tool_name = "final_answer_tool"
                tool_args = {"answer": "I've already explained my capabilities. How can I help you with ZebraCRM?"}
            elif tool_name == "build_ticket_tool":
                # Check if build_ticket was already used by checking history for ticket output
                # build_ticket is not in tool_counts, so we check differently
                if state.get("output_type") == "ticket":
                    logger.warning("build_ticket_tool already used, forcing final_answer")
                    tool_name = "final_answer_tool"
                    tool_args = {"answer": "I've already created a support ticket for you. Is there anything else I can help with?"}
            
            # Execute tool
            if tool_name == "bm25_tool":
                query = tool_args.get("query", "")
                logger.info(f"think_node: Calling bm25_tool with query: {query}")
                
                # Call the tool function
                result_text = bm25_tool_func(query)
                bm25_results.append(result_text)
                
                # Update state
                tool_counts["bm25"] = tool_counts.get("bm25", 0) + 1
                state["tool_counts"] = tool_counts
                state["bm25_results"] = bm25_results
                state["output"] = "tool: bm25"
                state["output_type"] = "tool"
                
                # Early detection: After first BM25 search, check if question is unrelated
                # If first search returned no results and question doesn't mention CRM terms, use capability_explanation
                if tool_counts["bm25"] == 1:  # First search
                    if "<data_1>No results found</data_1>" in result_text:
                        # No results found - check if question is clearly unrelated
                        if not _is_question_related_to_zebracrm(user_message, bm25_results):
                            logger.info("think_node: Early detection - first BM25 search found no results and question appears unrelated, using capability_explanation_tool")
                            if tool_counts.get("capability_explanation", 0) < 1:
                                # Use capability_explanation_tool
                                tool_counts["capability_explanation"] = tool_counts.get("capability_explanation", 0) + 1
                                state["tool_counts"] = tool_counts
                                state["output"] = "tool: capability_explanation"
                                state["output_type"] = "tool"
                                state["thinking_process"] = "capability_explanation_node"
                                
                                # Add tool message to history
                                tool_call_id = tool_call.get("id") or f"call_{tool_name}_{len(messages)}"
                                tool_message = ToolMessage(
                                    content=result_text,
                                    tool_call_id=tool_call_id
                                )
                                state["history"] = messages + [response, tool_message]
                                
                                logger.info(f"think_node: Early detection triggered - routing to capability_explanation_node")
                                return state
                
                state["thinking_process"] = "think_node"  # Loop back
                
                # Add tool message to history for next iteration
                tool_call_id = tool_call.get("id") or f"call_{tool_name}_{len(messages)}"
                tool_message = ToolMessage(
                    content=result_text,
                    tool_call_id=tool_call_id
                )
                state["history"] = messages + [response, tool_message]
                
                logger.info(f"think_node: Updated state - thinking_process={state.get('thinking_process')}, output_type={state.get('output_type')}, bm25_count={tool_counts['bm25']}")
                
            elif tool_name == "mcq_tool":
                question = tool_args.get("question", "")
                search_query = tool_args.get("search_query", question)  # Fallback to question if no search_query
                logger.info(f"think_node: Calling mcq_tool with question: {question}, search_query: {search_query}")
                
                # Call the tool function - it will search DB and return valid options
                mcq_text = mcq_tool_func(question, search_query)
                
                # Extract answers from the mcq_text for state storage
                answers_match = re.search(r'<answers>(.*?)</answers>', mcq_text)
                if answers_match:
                    try:
                        answers = json.loads(answers_match.group(1))
                        # Limit to maximum 3 answers (safeguard in case more are generated)
                        answers = answers[:3]
                    except json.JSONDecodeError:
                        answers = []
                else:
                    answers = []
                
                # Update state
                tool_counts["mcq"] = tool_counts.get("mcq", 0) + 1
                state["tool_counts"] = tool_counts
                state["mcq_question"] = question
                state["mcq_answers"] = answers
                state["output"] = mcq_text
                state["output_type"] = "mcq"
                state["thinking_process"] = "mcq_checkpoint"  # Route to checkpoint
                
                # Add AI message to history
                state["history"] = messages + [AIMessage(content=mcq_text)]
                
            elif tool_name == "final_answer_tool":
                answer = tool_args.get("answer", "")
                logger.info(f"think_node: Calling final_answer_tool with answer length: {len(answer)}")
                
                # Validate that the question is related to ZebraCRM before allowing final_answer
                if not _is_question_related_to_zebracrm(user_message, bm25_results):
                    logger.warning("think_node: Question appears unrelated to ZebraCRM, forcing capability_explanation_tool instead of final_answer_tool")
                    # Force capability_explanation_tool instead
                    if tool_counts.get("capability_explanation", 0) >= 1:
                        # Already used, but we'll still prevent final_answer
                        logger.warning("capability_explanation_tool already used, but preventing unrelated final_answer")
                        state["output"] = "אני יכול לעזור רק בשאלות הקשורות לזברה. אנא שאל אותי על תכונות זברה, פתרון בעיות או תמיכה."
                        state["output_type"] = "text"
                        state["thinking_process"] = "__end__"
                        state["history"] = messages + [AIMessage(content=state["output"])]
                        return state
                    else:
                        # Use capability_explanation_tool
                        tool_counts["capability_explanation"] = tool_counts.get("capability_explanation", 0) + 1
                        state["tool_counts"] = tool_counts
                        state["output"] = "tool: capability_explanation"
                        state["output_type"] = "tool"
                        state["thinking_process"] = "capability_explanation_node"
                        return state
                
                # Call the tool function
                final_answer_text = final_answer_tool_func(answer)
                
                # Update state
                tool_counts["final_answer"] = tool_counts.get("final_answer", 0) + 1
                state["tool_counts"] = tool_counts
                state["output"] = final_answer_text
                state["output_type"] = "text"
                state["thinking_process"] = "__end__"
                
                # Add AI message to history
                state["history"] = messages + [AIMessage(content=final_answer_text)]
                
            elif tool_name == "capability_explanation_tool":
                logger.info("think_node: Calling capability_explanation_tool")
                
                # Call the tool function
                capability_explanation_tool_func()
                
                # Update state
                tool_counts["capability_explanation"] = tool_counts.get("capability_explanation", 0) + 1
                state["tool_counts"] = tool_counts
                state["output"] = "tool: capability_explanation"
                state["output_type"] = "tool"
                state["thinking_process"] = "capability_explanation_node"  # Route to capability node
                
            elif tool_name == "build_ticket_tool":
                logger.info("think_node: Calling build_ticket_tool")
                
                # Call the tool function
                ticket_json = build_ticket_tool_func()
                
                # Update state (build_ticket is not tracked in tool_counts)
                state["tool_counts"] = tool_counts
                state["output"] = ticket_json
                state["output_type"] = "ticket"
                state["thinking_process"] = "__end__"
                
                # Add AI message to history with full ticket details
                state["history"] = messages + [AIMessage(content=f"Support ticket created: {ticket_json}")]
                
        else:
            # No tool call - LLM provided direct answer (shouldn't happen with tools, but handle gracefully)
            logger.warning("think_node: LLM returned no tool calls, forcing final_answer")
            content = response.content or "I apologize, but I'm having trouble processing your request. Could you rephrase?"
            state["output"] = content
            state["output_type"] = "text"
            state["thinking_process"] = "__end__"
            state["history"] = messages + [response]
            
    except (ValueError, KeyError, AttributeError) as e:
        # Recoverable error - state/data structure issues
        logger.warning(f"think_node: Recoverable error: {e}", exc_info=True)
        state["output"] = "I encountered an issue processing your request. Please try rephrasing your question."
        state["output_type"] = "text"
        state["thinking_process"] = "__end__"
    except Exception as e:
        # Fatal error - LLM API failure or other critical issue
        logger.error(f"think_node: Fatal error: {e}", exc_info=True)
        # Fallback: provide error message
        state["output"] = "I encountered an error processing your request. Please try again."
        state["output_type"] = "text"
        state["thinking_process"] = "__end__"
    
    return state


def mcq_response_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Process MCQ response from user and extract selected answer number.
    
    User's response should contain the answer number (1, 2, 3, etc.) or the answer text.
    This node extracts the selection and continues to think_node.
    """
    messages: List[Any] = state.get("history", [])
    mcq_answers: List[str] = state.get("mcq_answers", [])
    
    # Get user's response (last human message)
    user_response = get_last_user_message(messages) or ""
    
    # Try to extract answer number from response
    selected_index = None
    
    # First, try to find a number (1, 2, 3, etc.)
    numbers = re.findall(r'\b(\d+)\b', user_response)
    if numbers:
        try:
            num = int(numbers[0])
            if 1 <= num <= len(mcq_answers):
                selected_index = num - 1  # Convert to 0-based index
        except ValueError:
            pass
    
    # If no number found, try to match answer text
    if selected_index is None:
        user_response_lower = user_response.lower().strip()
        for idx, answer in enumerate(mcq_answers):
            if answer.lower().strip() in user_response_lower or user_response_lower in answer.lower().strip():
                selected_index = idx
                break
    
    # Default to first answer if nothing matched
    if selected_index is None:
        selected_index = 0
        logger.warning(f"Could not parse MCQ response '{user_response}', defaulting to first answer")
    
    # Store selected answer
    state["mcq_selected"] = selected_index
    selected_answer = mcq_answers[selected_index] if mcq_answers else ""
    
    logger.info(f"mcq_response_node: User selected answer {selected_index + 1}: {selected_answer}")
    
    # Add tool message with selected answer number for think_node to use
    tool_message = ToolMessage(
        content=f"Selected answer: {selected_index + 1} - {selected_answer}",
        tool_call_id="mcq_response"
    )
    state["history"] = messages + [tool_message]
    state["thinking_process"] = "think_node"  # Continue to think_node
    
    return state
