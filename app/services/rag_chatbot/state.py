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
    bm25_results: list[str]  # Results from bm25 calls this run (formatted as <data_N>...</data_N>)
    mcq_question: str  # Current MCQ question (if any)
    mcq_answers: list[str]  # Current MCQ answer options (if any)
    mcq_selected: int | None  # Selected answer index (after checkpoint)
