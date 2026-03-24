"""Utility functions for the RAG chatbot."""

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from typing import Optional, List, Any
from app.core.config import MODEL, settings
import re
import logging

_utils_logger = logging.getLogger(__name__)

# Unicode ranges for scripts that should NOT appear in Hebrew/English responses
_FOREIGN_SCRIPT_RE = re.compile(
    r'['
    r'\u0400-\u052F'  # Cyrillic + Supplement
    r'\u0600-\u06FF'  # Arabic
    r'\u0750-\u077F'  # Arabic Supplement
    r'\u08A0-\u08FF'  # Arabic Extended-A
    r'\u0E00-\u0E7F'  # Thai
    r'\u0E80-\u0EFF'  # Lao
    r'\u1000-\u109F'  # Myanmar
    r'\u3040-\u309F'  # Hiragana
    r'\u30A0-\u30FF'  # Katakana
    r'\u4E00-\u9FFF'  # CJK
    r'\u0900-\u097F'  # Devanagari
    r'\uAC00-\uD7AF'  # Hangul
    r'\uFB50-\uFDFF'  # Arabic Presentation Forms-A
    r'\uFE70-\uFEFF'  # Arabic Presentation Forms-B
    r']+'
)


def has_foreign_script(text: str) -> bool:
    """Check if text contains characters from unexpected scripts."""
    return bool(text and _FOREIGN_SCRIPT_RE.search(text))


def sanitize_response_language(text: str) -> str:
    """Fix foreign-script words (Cyrillic, Arabic, Thai, etc.) in Hebrew/English text.

    Re-prompts the LLM to replace foreign words with Hebrew equivalents.
    Returns original text if no contamination detected.
    """
    if not text or not has_foreign_script(text):
        return text

    foreign_words = _FOREIGN_SCRIPT_RE.findall(text)
    unique_foreign = list(dict.fromkeys(foreign_words))
    _utils_logger.warning(
        "Foreign script detected in LLM output: %s", unique_foreign
    )

    llm = create_llm(temperature=0.0)
    fix_prompt = (
        "The following text is in Hebrew but contains words in a different language. "
        f"These are the foreign words: {unique_foreign}\n"
        "Replace ONLY those words with their Hebrew equivalents. "
        "Keep everything else exactly the same. "
        "Return ONLY the corrected text.\n\n"
        f"{text}"
    )

    try:
        response = llm.invoke([HumanMessage(content=fix_prompt)])
        cleaned = response.content.strip()
        if not has_foreign_script(cleaned):
            _utils_logger.info("Foreign script cleanup successful")
            return cleaned
        _utils_logger.warning("Cleanup still has foreign scripts, stripping words")
    except Exception as e:
        _utils_logger.warning("Foreign script cleanup LLM call failed: %s", e)
        cleaned = text

    # Last resort: remove tokens containing foreign scripts
    tokens = cleaned.split()
    return ' '.join(t for t in tokens if not _FOREIGN_SCRIPT_RE.search(t))


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


def extract_llm_token_usage(response) -> tuple[int, int]:
    """Extract (input_tokens, output_tokens) from a LangChain AIMessage response.

    Checks usage_metadata first (modern LangChain), falls back to response_metadata.
    """
    if hasattr(response, 'usage_metadata') and response.usage_metadata:
        return (
            response.usage_metadata.get('input_tokens', 0) or 0,
            response.usage_metadata.get('output_tokens', 0) or 0,
        )
    if hasattr(response, 'response_metadata') and response.response_metadata:
        tu = response.response_metadata.get('token_usage', {})
        return (
            tu.get('prompt_tokens', 0) or 0,
            tu.get('completion_tokens', 0) or 0,
        )
    return (0, 0)

