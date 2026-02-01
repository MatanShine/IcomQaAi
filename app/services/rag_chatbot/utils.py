"""Utility functions for the RAG chatbot."""

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from typing import Optional, List, Any
from app.core.config import MODEL, settings


def is_human_message(msg: Any) -> bool:
    """Check if a message is a human/user message.
    
    Args:
        msg: Message object to check
        
    Returns:
        True if the message is from a human user, False otherwise
    """
    if isinstance(msg, HumanMessage):
        return True
    if hasattr(msg, "__class__"):
        class_name = msg.__class__.__name__
        if class_name == "HumanMessage":
            return True
        if "Human" in str(msg.__class__):
            return True
    return False


def is_ai_message(msg: Any) -> bool:
    """Check if a message is an AI/assistant message.
    
    Args:
        msg: Message object to check
        
    Returns:
        True if the message is from the AI assistant, False otherwise
    """
    if isinstance(msg, AIMessage):
        return True
    if hasattr(msg, "__class__"):
        class_name = msg.__class__.__name__
        if class_name == "AIMessage":
            return True
        if "AI" in str(msg.__class__):
            return True
    return False


def get_message_content(msg: Any) -> str:
    """Extract content from a message object.
    
    Args:
        msg: Message object
        
    Returns:
        Content string from the message
    """
    if hasattr(msg, "content"):
        return str(msg.content)
    return str(msg)


def get_last_user_message(messages: List[Any]) -> Optional[str]:
    """Get the last user message from a list of messages.
    
    Args:
        messages: List of message objects
        
    Returns:
        Content of the last user message, or None if not found
    """
    for msg in reversed(messages):
        if is_human_message(msg):
            return get_message_content(msg)
    return None


def count_tokens_approximate(text: str) -> int:
    """
    Approximate token count using the rule: 1 token ≈ 4 characters.
    
    Args:
        text: The text to count tokens for
        
    Returns:
        Approximate number of tokens
    """
    if not text:
        return 0
    return len(text) // 4


def count_history_tokens(history: list[BaseMessage]) -> int:
    """
    Count approximate tokens for a list of messages.
    
    Args:
        history: List of BaseMessage objects
        
    Returns:
        Total approximate token count
    """
    total = 0
    for msg in history:
        if hasattr(msg, 'content'):
            total += count_tokens_approximate(str(msg.content))
        else:
            total += count_tokens_approximate(str(msg))
    return total


def truncate_text_by_tokens(text: str, max_tokens: int) -> str:
    """Truncate text to fit within a maximum token count.
    
    Args:
        text: Text to truncate
        max_tokens: Maximum number of tokens allowed
        
    Returns:
        Truncated text that fits within max_tokens
    """
    if not text:
        return text
    
    max_chars = max_tokens * 4  # Approximate: 1 token ≈ 4 characters
    if len(text) <= max_chars:
        return text
    
    # Truncate and add ellipsis
    truncated = text[:max_chars - 3]
    # Try to truncate at word boundary
    last_space = truncated.rfind(' ')
    if last_space > max_chars * 0.8:  # Only if we're not losing too much
        truncated = truncated[:last_space]
    return truncated + "..."


def truncate_history(history: list[BaseMessage], max_messages: int = 15) -> list[BaseMessage]:
    """Truncate history to last N messages.
    
    Args:
        history: List of message objects
        max_messages: Maximum number of messages to keep
    
    Returns:
        Truncated list with only the last max_messages
    """
    if len(history) <= max_messages:
        return history
    return history[-max_messages:]


def create_llm(temperature: float = 0.1, model: str = None) -> ChatOpenAI:
    """Create a ChatOpenAI instance with shared configuration.
    
    This factory function ensures consistent LLM configuration across the codebase
    and reduces the overhead of creating multiple instances with the same settings.
    
    Args:
        temperature: Temperature for the LLM (default: 0.1)
        model: Model name to use (default: MODEL from config)
    
    Returns:
        Configured ChatOpenAI instance
    """
    return ChatOpenAI(
        model=model or MODEL,
        api_key=settings.openai_api_key,
        temperature=temperature,
    )

