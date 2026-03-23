import logging
import time
from app.models.db import SessionLocal, PromptVersion

logger = logging.getLogger(__name__)

# In-memory cache: {(prompt_type, status): (content, timestamp)}
_cache: dict[tuple[str, str], tuple[str, float]] = {}
_CACHE_TTL_SECONDS = 60


def _get_from_cache(prompt_type: str, status: str) -> str | None:
    key = (prompt_type, status)
    if key in _cache:
        content, ts = _cache[key]
        if time.time() - ts < _CACHE_TTL_SECONDS:
            return content
        del _cache[key]
    return None


def _set_cache(prompt_type: str, status: str, content: str) -> None:
    _cache[(prompt_type, status)] = (content, time.time())


def resolve_prompt(prompt_type: str, is_test_session: bool = False) -> str | None:
    """Resolve prompt content from the database.

    Args:
        prompt_type: e.g. "system_prompt", "capability_explanation"
        is_test_session: if True, prefer the "testing" version

    Returns:
        Prompt content string, or None if no version exists (caller uses hardcoded default).
    """
    if is_test_session:
        content = _resolve_by_status(prompt_type, "testing")
        if content is not None:
            return content

    return _resolve_by_status(prompt_type, "published")


def _resolve_by_status(prompt_type: str, status: str) -> str | None:
    cached = _get_from_cache(prompt_type, status)
    if cached is not None:
        return cached

    try:
        with SessionLocal() as session:
            row = (
                session.query(PromptVersion)
                .filter(
                    PromptVersion.prompt_type == prompt_type,
                    PromptVersion.status == status,
                )
                .first()
            )
            if row is None:
                return None
            _set_cache(prompt_type, status, row.content)
            return row.content
    except Exception:
        logger.exception("Failed to resolve prompt %s/%s from DB", prompt_type, status)
        return None


def get_active_prompt_version_id(prompt_type: str, is_test_session: bool = False) -> int | None:
    """Return the ID of the active prompt version (for recording in prompt_test_sessions)."""
    status = "testing" if is_test_session else "published"
    try:
        with SessionLocal() as session:
            row = (
                session.query(PromptVersion)
                .filter(
                    PromptVersion.prompt_type == prompt_type,
                    PromptVersion.status == status,
                )
                .first()
            )
            if row is None and is_test_session:
                row = (
                    session.query(PromptVersion)
                    .filter(
                        PromptVersion.prompt_type == prompt_type,
                        PromptVersion.status == "published",
                    )
                    .first()
                )
            return row.id if row else None
    except Exception:
        logger.exception("Failed to get prompt version ID for %s", prompt_type)
        return None


def invalidate_prompt_cache() -> None:
    """Clear the prompt cache (useful for testing)."""
    _cache.clear()
