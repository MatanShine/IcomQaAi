"""Graph factory for LangGraph Studio.

This module provides a factory function that LangGraph Studio can use to
load and inspect the agent graph for development and debugging.
It reuses the Agent class's graph building logic to avoid code duplication.
"""

import logging
from langgraph.graph.state import CompiledStateGraph
from app.services.rag_chatbot.agent import Agent


def create_graph() -> CompiledStateGraph:
    """Create and return the compiled LangGraph agent graph.
    
    This function is used by LangGraph Studio to load the graph for
    visualization, debugging, and development. It reuses the Agent
    class's graph building logic to ensure consistency.
    
    Returns:
        A compiled StateGraph instance ready for execution.
    """
    # Create a minimal logger for Agent initialization
    logger = logging.getLogger("langgraph_studio")
    logger.setLevel(logging.WARNING)  # Reduce noise during graph loading
    
    try:
        # Create an Agent instance which builds the graph in __init__
        agent = Agent(logger)
        
        # Return the compiled graph from the Agent
        return agent.graph
    except Exception as e:
        logger.error(f"Failed to create graph: {e}", exc_info=True)
        raise
