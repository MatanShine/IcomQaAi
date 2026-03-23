"""State definition for the LangGraph agent."""

from __future__ import annotations
from typing import TypedDict
from langchain_core.messages import BaseMessage


class AgentState(TypedDict):
    """Simple state for the LangGraph agent - no accumulation reducers."""
    
    history: list[BaseMessage]  # Passed in, not accumulated
    output: str  # Current output to stream
    output_type: str  # "tool", "mcq", "text", "ticket"
    tool_counts: dict[str, int]  # {"bm25": 0, "mcq": 0, "final_answer": 0, "capability_explanation": 0}
    bm25_queries: list[str]  # Search queries used in bm25 calls this run
    bm25_raw_contexts: dict  # Raw retrieval context {str(id): [question, answer, url]} for DB storage
    total_tokens_sent: int  # Accumulated prompt/input tokens across all LLM calls
    total_tokens_received: int  # Accumulated completion/output tokens across all LLM calls
    mcq_question: str  # Current MCQ question (if any)
    mcq_answers: list[str]  # Current MCQ answer options (if any)
    mcq_selected: int | None  # Selected answer index (after checkpoint)
    is_test: bool  # Whether this is a test session (uses testing prompt version)
