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
    extract_llm_token_usage,
    sanitize_response_language,
)
from app.services.rag_chatbot.prompt_resolver import resolve_prompt
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


def _build_kb_context_text(bm25_raw_contexts: dict) -> str:
    """Build deduplicated Knowledge Base Context section from raw contexts."""
    if not bm25_raw_contexts:
        return "Knowledge Base Context: None yet"
    parts = []
    for i, (idx, value) in enumerate(bm25_raw_contexts.items(), 1):
        q, a = value[0], value[1]
        parts.append(f"<context_{i}>\nQuestion: {q}\nAnswer: {a}\n</context_{i}>")
    return f"Knowledge Base Context ({len(bm25_raw_contexts)} unique results):\n" + chr(10).join(parts)


def _build_prev_queries_text(bm25_queries: list) -> str:
    """Build Previous search queries section."""
    if not bm25_queries:
        return ""
    queries_list = chr(10).join(f'  {i+1}. "{q}"' for i, q in enumerate(bm25_queries))
    return f"\nPrevious search queries (use DIFFERENT terms and angles, do NOT rearrange the same words):\n{queries_list}"


def _is_question_related_to_zebracrm(user_message: str, bm25_raw_contexts: dict) -> bool:
    """Check if a question is related to ZebraCRM.

    Args:
        user_message: The user's question
        bm25_raw_contexts: Raw retrieval context dict {str(id): [question, answer, url]}

    Returns:
        True if the question is related to ZebraCRM, False otherwise
    """
    user_lower = user_message.lower()

    # Check if BM25 search returned relevant results
    has_relevant_results = bool(bm25_raw_contexts)
    
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
    - bm25: Search knowledge base (until 25 unique contexts accumulated)
    - mcq: Ask multiple choice question (max 1 time per user input)
    - final_answer: Provide final answer to user (max 1 time per user input)
    - capability_explanation: Explain capabilities and route to ticket (max 1 time per user input)
    - build_ticket: Build support ticket when problem is known but unsolved, user requests support contact, or agent couldn't solve issue (max 1 time per user input)
    """
    messages: List[Any] = state.get("history", [])
    # Use setdefault to initialize and get in one operation
    tool_counts: Dict[str, int] = state.setdefault("tool_counts", {"bm25": 0, "mcq": 0, "final_answer": 0, "capability_explanation": 0})
    bm25_queries: List[str] = state.setdefault("bm25_queries", [])
    bm25_raw_contexts: Dict = state.setdefault("bm25_raw_contexts", {})
    total_tokens_sent: int = state.get("total_tokens_sent", 0)
    total_tokens_received: int = state.get("total_tokens_received", 0)

    # Initialize other state defaults
    state.setdefault("output", "")
    state.setdefault("output_type", "")
    
    # Get user's current message
    user_message = get_last_user_message(messages) or ""
    
    # Get question titles for context
    question_titles = _get_all_question_titles(logger)
    question_titles_text = ""
    if question_titles:
        question_titles_list = "\n".join([f"{i+1}. {title}" for i, title in enumerate(question_titles)])
        question_titles_text = f"""
Available Questions in Knowledge Base ({len(question_titles)} total):
{question_titles_list}
"""
    
    # Build system prompt
    is_test = state.get("is_test", False)
    db_prompt = resolve_prompt("system_prompt", is_test_session=is_test)
    if db_prompt is not None:
        system_prompt = db_prompt.format(
            question_titles_text=question_titles_text,
            kb_context=_build_kb_context_text(bm25_raw_contexts),
            previous_queries=_build_prev_queries_text(bm25_queries),
            tool_usage_counts=f"bm25_calls={tool_counts.get('bm25', 0)} (unique_contexts={len(bm25_raw_contexts)}/25), mcq={tool_counts.get('mcq', 0)}/1, final_answer={tool_counts.get('final_answer', 0)}/1, capability_explanation={tool_counts.get('capability_explanation', 0)}/1",
            tool_limits="bm25_tool: maximum 25 unique contexts. mcq_tool: maximum 1 time. final_answer_tool: maximum 1 time. capability_explanation_tool: maximum 1 time. build_ticket_tool: ALWAYS available, maximum 1 time per user input.",
        )
    else:
        system_prompt = f"""You are a customer support assistant for ZebraCRM.

LANGUAGE RULE (HIGHEST PRIORITY): You MUST respond in the SAME language as the user's message. If the user writes in Hebrew, respond in Hebrew. If in English, respond in English. Match the user's language exactly. This applies to ALL your outputs: final answers, MCQ questions, ticket fields, and any other text you generate. Even if the knowledge base content is in a different language, YOUR response must match the USER's language.

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
1. bm25_tool: Search the knowledge base with a query. Returns up to 5 results formatted as <data_1>...</data_1>...<data_5>...</data_5>. IMPORTANT: Always write standalone, self-contained search queries that include relevant context from the conversation. Do not use pronouns or references to prior messages — each query must make sense on its own.
2. mcq_tool: Ask a multiple choice question to clarify user needs. IMPORTANT: Before using this tool, you MUST first search the knowledge base using bm25_tool. Then provide a 'question' and 'answers' (2-3 options based on search results). Question and answers must be coherent.
3. final_answer_tool: Provide the final answer to the user's question. ONLY use this for ZebraCRM-related questions that you can answer.
4. capability_explanation_tool: Explain what you can and cannot do. Use this for questions completely unrelated to ZebraCRM. You MUST use this tool when the question is not about ZebraCRM.
5. build_ticket_tool: Build a support ticket when user explicitly requests a ticket (e.g., "פנייה", "לפתוח פנייה", "אפשר פנייה", "open ticket") OR when you know the user's problem but couldn't solve it OR user asks for customer support contact

IMPORTANT: When the user explicitly asks to open a ticket (e.g., "פנייה", "לפתוח פנייה", "אפשר פנייה"), you MUST use build_ticket_tool immediately. Do NOT use final_answer_tool for ticket requests.

Tool limits per user input:
- bm25_tool: maximum 25 unique contexts. Use as FEW searches as possible — only search again if prior results are insufficient to answer confidently.
- mcq_tool: maximum 1 time
- final_answer_tool: maximum 1 time
- capability_explanation_tool: maximum 1 time
- build_ticket_tool: ALWAYS available (not counted in tool limits), maximum 1 time per user input

Current tool usage: bm25_calls={tool_counts.get("bm25", 0)} (unique_contexts={len(bm25_raw_contexts)}/25), mcq={tool_counts.get("mcq", 0)}/1, final_answer={tool_counts.get("final_answer", 0)}/1, capability_explanation={tool_counts.get("capability_explanation", 0)}/1

Note: build_ticket_tool and final_answer_tool are always available regardless of other tool limits.

{_build_kb_context_text(bm25_raw_contexts)}
{_build_prev_queries_text(bm25_queries)}
You may call bm25_tool multiple times but PREFER fewer calls. If the first search gives a good answer, use final_answer_tool immediately. Only search again when the user's question spans different topics or the initial results don't cover all aspects of the question.

Use tools strategically to gather information before providing a final answer. If after searching you determine the question is unrelated to ZebraCRM, use capability_explanation_tool."""

    # Create LLM with tool definitions
    llm = create_llm(temperature=0.1)
    
    # Define tool schemas using Pydantic
    class BM25ToolInput(BaseModel):
        query: str = Field(description="The search query to find relevant information")
    
    class MCQToolInput(BaseModel):
        question: str = Field(description="The multiple choice question to ask the user to clarify their needs. Must be in the same language as the user's message.")
        answers: list[str] = Field(description="2-3 answer options based on knowledge base search results, in the user's language")
    
    class FinalAnswerToolInput(BaseModel):
        answer: str = Field(description="The final answer to provide to the user. Must be in the same language as the user's message.")
    
    class CapabilityExplanationToolInput(BaseModel):
        pass
    
    class BuildTicketToolInput(BaseModel):
        pass  # No input needed - LLM generates from conversation context
    
    # Create tool functions
    def bm25_tool_func(query: str) -> tuple[str, dict]:
        """Search the knowledge base with a query. Returns formatted results and raw contexts."""
        retriever = _get_shared_retriever(logger)
        try:
            contexts = retriever.retrieve_contexts(query)
        except (AttributeError, ValueError) as e:
            logger.warning(f"bm25_tool: Retriever error: {e}")
            contexts = {}
        except Exception as e:
            logger.error(f"bm25_tool: Unexpected error: {e}", exc_info=True)
            contexts = {}

        formatted_results = []
        if contexts:
            for idx, (q, a, url) in enumerate(contexts.values(), 1):
                formatted_results.append(f"<data_{idx}>\nQuestion: {q}\nAnswer: {a}\n</data_{idx}>")
        else:
            formatted_results.append("<data_1>No results found</data_1>")

        return "\n".join(formatted_results), contexts
    
    def mcq_tool_func(question: str, answers: list[str]) -> str:
        """Ask a multiple choice question to clarify user needs.

        The LLM provides both the question and answer options directly,
        based on prior bm25_tool search results.
        """
        # Strip, dedupe, and filter empty answers
        seen = set()
        valid_answers = []
        for a in answers:
            stripped = a.strip() if isinstance(a, str) else ""
            if stripped and stripped not in seen:
                valid_answers.append(stripped)
                seen.add(stripped)
                if len(valid_answers) >= 3:
                    break

        # Fallback if fewer than 2 valid answers
        if len(valid_answers) < 2:
            all_titles = _get_all_question_titles(logger)
            valid_answers = all_titles[:3] if all_titles else ["לא נמצאו תוצאות רלוונטיות"]

        logger.info(f"mcq_tool: {len(valid_answers)} options for question: {question}")
        return f"<question>{question}</question><answers>{json.dumps(valid_answers, ensure_ascii=False)}</answers>"
    
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

        try:
            response = ticket_llm.invoke([HumanMessage(content=ticket_prompt)])
            ticket_json = response.content.strip()

            # Accumulate token usage from ticket LLM call
            sent, received = extract_llm_token_usage(response)
            nonlocal total_tokens_sent, total_tokens_received
            total_tokens_sent += sent
            total_tokens_received += received
            state["total_tokens_sent"] = total_tokens_sent
            state["total_tokens_received"] = total_tokens_received

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

            for key in ("category", "title", "description"):
                if key in ticket_data:
                    ticket_data[key] = sanitize_response_language(ticket_data[key])

            return json.dumps(ticket_data, ensure_ascii=False)
        except Exception as e:
            logger.error(f"build_ticket_tool error: {e}", exc_info=True)
            return json.dumps({
                "category": "Support Request",
                "title": "Customer Support Request",
                "description": "The user requested customer support assistance."
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
            description="Present a multiple choice question. You MUST search with bm25_tool BEFORE using this tool. Provide 'question' and 'answers' (2-3 options from search results). Question and answers must be coherent and in the SAME language as the user's message. Max 1 use per input.",
            args_schema=MCQToolInput,
        ),
        StructuredTool.from_function(
            func=final_answer_tool_func,
            name="final_answer_tool",
            description="Provide the final answer to the user's question in the SAME language as the user's message. ONLY use this for ZebraCRM-related questions that you can answer based on the knowledge base or conversation context. Do NOT use this for questions unrelated to ZebraCRM. Can only be used once per user input.",
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
    
    # Bind tools to LLM (parallel_tool_calls allows multiple tool calls per response)
    llm_with_tools = llm.bind_tools(tools, parallel_tool_calls=True)
    
    # Prepare messages for LLM (include system prompt as first message)
    llm_messages = [HumanMessage(content=system_prompt)] + messages
    
    try:
        # Invoke LLM with tool calling
        response = llm_with_tools.invoke(llm_messages)

        # Accumulate token usage from LLM response
        sent, received = extract_llm_token_usage(response)
        total_tokens_sent += sent
        total_tokens_received += received
        state["total_tokens_sent"] = total_tokens_sent
        state["total_tokens_received"] = total_tokens_received

        # Check if LLM wants to call a tool
        if hasattr(response, 'tool_calls') and response.tool_calls:
            # --- Parse all tool calls and categorize them ---
            def _parse_tool_call(tc):
                name = tc.get("name") or tc.get("function", {}).get("name", "")
                args_raw = tc.get("args") or tc.get("function", {}).get("arguments", "{}")
                if isinstance(args_raw, str):
                    try:
                        args = json.loads(args_raw)
                    except json.JSONDecodeError:
                        args = {}
                else:
                    args = args_raw or {}
                return name, args

            bm25_calls = []  # list of (tool_call, query)
            terminal_call = None  # (tool_call, name, args) — first non-bm25 tool
            for tc in response.tool_calls:
                name, args = _parse_tool_call(tc)
                if name == "bm25_tool":
                    bm25_calls.append((tc, args.get("query", "")))
                elif terminal_call is None:
                    terminal_call = (tc, name, args)

            # --- BM25 calls present: execute them, discard terminal tools, loop back ---
            if bm25_calls:
                max_unique_contexts = 25
                tool_messages = []
                executed_any = False
                # Collect all raw contexts from this batch for deduplication
                batch_raw_contexts: dict[int, tuple] = {}

                for tc, query in bm25_calls:
                    tc_id = tc.get("id") or f"call_bm25_{len(messages)}_{len(tool_messages)}"
                    if len(bm25_raw_contexts) + len(batch_raw_contexts) >= max_unique_contexts:
                        # Context limit reached — still provide a ToolMessage so the protocol is satisfied
                        tool_messages.append(ToolMessage(
                            content=f"BM25 context limit reached ({len(bm25_raw_contexts) + len(batch_raw_contexts)}/{max_unique_contexts} unique contexts)",
                            tool_call_id=tc_id,
                        ))
                        logger.warning(f"think_node: BM25 context limit reached ({len(bm25_raw_contexts) + len(batch_raw_contexts)}/{max_unique_contexts}), skipping query: {query}")
                        continue

                    logger.info(f"think_node: Calling bm25_tool with query: {query}")
                    result_text, raw_contexts = bm25_tool_func(query)
                    # Merge into batch (int keys from retriever)
                    for idx, value in raw_contexts.items():
                        batch_raw_contexts[idx] = value

                    # Create COMPACT ToolMessage (full content goes to bm25_raw_contexts only)
                    titles = [ctx[0] for ctx in raw_contexts.values()]
                    compact_content = f'Search: "{query}"\nFound {len(titles)} results: {", ".join(titles)}'
                    tool_messages.append(ToolMessage(content=compact_content, tool_call_id=tc_id))

                    # Track query
                    bm25_queries.append(query)
                    tool_counts["bm25"] = tool_counts.get("bm25", 0) + 1
                    executed_any = True

                # Deduplicate and merge into state (use str keys to match existing convention)
                for idx, value in batch_raw_contexts.items():
                    bm25_raw_contexts[str(idx)] = list(value)
                state["bm25_raw_contexts"] = bm25_raw_contexts

                state["tool_counts"] = tool_counts
                state["bm25_queries"] = bm25_queries
                state["output"] = "tool: bm25"
                state["output_type"] = "tool"

                # Early detection: if first-ever BM25 search(es) all returned nothing and question is unrelated
                if not batch_raw_contexts and not bm25_raw_contexts:
                    if not _is_question_related_to_zebracrm(user_message, bm25_raw_contexts):
                        logger.info("think_node: Early detection - BM25 searches found no results and question appears unrelated")
                        if tool_counts.get("capability_explanation", 0) < 1:
                            tool_counts["capability_explanation"] = tool_counts.get("capability_explanation", 0) + 1
                            state["tool_counts"] = tool_counts
                            state["output"] = "tool: capability_explanation"
                            state["output_type"] = "tool"
                            state["thinking_process"] = "capability_explanation_node"
                            state["history"] = messages + [response] + tool_messages
                            return state

                # Edge case: all BM25 calls were rejected (context limit reached) and no results executed
                if not executed_any:
                    logger.warning("think_node: All BM25 calls rejected (limit reached), forcing fallback")
                    if not _is_question_related_to_zebracrm(user_message, bm25_raw_contexts):
                        if tool_counts.get("capability_explanation", 0) < 1:
                            tool_counts["capability_explanation"] = tool_counts.get("capability_explanation", 0) + 1
                            state["tool_counts"] = tool_counts
                            state["output"] = "tool: capability_explanation"
                            state["output_type"] = "tool"
                            state["thinking_process"] = "capability_explanation_node"
                            state["history"] = messages + [response] + tool_messages
                            return state
                    # Force final answer fallback
                    state["output"] = "I've searched extensively but couldn't find specific information. Could you provide more details or rephrase your question?"
                    state["output_type"] = "text"
                    state["thinking_process"] = "__end__"
                    state["history"] = messages + [response] + tool_messages + [AIMessage(content=state["output"])]
                    return state

                state["thinking_process"] = "think_node"  # Loop back
                # History: AIMessage (with all tool_calls) + one ToolMessage per call
                state["history"] = messages + [response] + tool_messages
                logger.info(f"think_node: Executed {len([m for m in tool_messages if 'limit reached' not in m.content])} BM25 searches, {len(batch_raw_contexts)} new passages, total_unique={len(bm25_raw_contexts)}, bm25_calls={tool_counts['bm25']}")

            # --- No BM25 calls: execute the single terminal tool ---
            elif terminal_call is not None:
                tool_call, tool_name, tool_args = terminal_call

                # Enforce tool limits (same logic as before)
                if tool_name == "mcq_tool" and tool_counts.get("mcq", 0) >= 1:
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
                    if state.get("output_type") == "ticket":
                        logger.warning("build_ticket_tool already used, forcing final_answer")
                        tool_name = "final_answer_tool"
                        tool_args = {"answer": "I've already created a support ticket for you. Is there anything else I can help with?"}

                # Execute the terminal tool
                if tool_name == "mcq_tool":
                    question = tool_args.get("question", "")
                    answers_from_llm = tool_args.get("answers", [])
                    logger.info(f"think_node: Calling mcq_tool with question: {question}, answers: {answers_from_llm}")

                    mcq_text = mcq_tool_func(question, answers_from_llm)

                    answers_match = re.search(r'<answers>(.*?)</answers>', mcq_text)
                    if answers_match:
                        try:
                            answers = json.loads(answers_match.group(1))
                            answers = answers[:3]
                        except json.JSONDecodeError:
                            answers = []
                    else:
                        answers = []

                    tool_counts["mcq"] = tool_counts.get("mcq", 0) + 1
                    state["tool_counts"] = tool_counts
                    state["mcq_question"] = question
                    state["mcq_answers"] = answers
                    state["output"] = mcq_text
                    state["output_type"] = "mcq"
                    state["thinking_process"] = "mcq_checkpoint"
                    state["history"] = messages + [AIMessage(content=mcq_text)]

                elif tool_name == "final_answer_tool":
                    answer = tool_args.get("answer", "")
                    logger.info(f"think_node: Calling final_answer_tool with answer length: {len(answer)}")

                    # Validate question is related to ZebraCRM
                    if not _is_question_related_to_zebracrm(user_message, bm25_raw_contexts):
                        logger.warning("think_node: Question appears unrelated to ZebraCRM, forcing capability_explanation_tool")
                        if tool_counts.get("capability_explanation", 0) >= 1:
                            logger.warning("capability_explanation_tool already used, but preventing unrelated final_answer")
                            state["output"] = "אני יכול לעזור רק בשאלות הקשורות לזברה. אנא שאל אותי על תכונות זברה, פתרון בעיות או תמיכה."
                            state["output_type"] = "text"
                            state["thinking_process"] = "__end__"
                            state["history"] = messages + [AIMessage(content=state["output"])]
                            return state
                        else:
                            tool_counts["capability_explanation"] = tool_counts.get("capability_explanation", 0) + 1
                            state["tool_counts"] = tool_counts
                            state["output"] = "tool: capability_explanation"
                            state["output_type"] = "tool"
                            state["thinking_process"] = "capability_explanation_node"
                            return state

                    final_answer_text = sanitize_response_language(final_answer_tool_func(answer))
                    tool_counts["final_answer"] = tool_counts.get("final_answer", 0) + 1
                    state["tool_counts"] = tool_counts
                    state["output"] = final_answer_text
                    state["output_type"] = "text"
                    state["thinking_process"] = "__end__"
                    state["history"] = messages + [AIMessage(content=final_answer_text)]

                elif tool_name == "capability_explanation_tool":
                    logger.info("think_node: Calling capability_explanation_tool")
                    capability_explanation_tool_func()
                    tool_counts["capability_explanation"] = tool_counts.get("capability_explanation", 0) + 1
                    state["tool_counts"] = tool_counts
                    state["output"] = "tool: capability_explanation"
                    state["output_type"] = "tool"
                    state["thinking_process"] = "capability_explanation_node"

                elif tool_name == "build_ticket_tool":
                    logger.info("think_node: Calling build_ticket_tool")
                    ticket_json = build_ticket_tool_func()
                    state["tool_counts"] = tool_counts
                    state["output"] = ticket_json
                    state["output_type"] = "ticket"
                    state["thinking_process"] = "__end__"
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
