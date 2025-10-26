"""Utilities for normalizing and tokenizing Hebrew support content."""

from __future__ import annotations

import re
from typing import Iterable, List

from bs4 import BeautifulSoup

HEBREW_STOPWORDS = {
    "של",
    "עם",
    "גם",
    "אם",
    "על",
    "זה",
    "או",
    "כל",
    "לא",
    "כן",
    "יש",
    "אין",
    "מה",
    "איך",
    "אני",
    "אתה",
    "את",
    "אנחנו",
    "הם",
    "הן",
    "להיות",
    "היה",
    "היו",
    "מאוד",
    "יותר",
    "פחות",
    "שלך",
    "שלכם",
    "שלכן",
    "למה",
    "כדי",
    "כי",
    "האם",
    "יכול",
    "יכולה",
    "אפשר",
    "צריך",
    "צריכה",
    "תודה",
}

# Match Hebrew letters, English letters, digits and apostrophes
TOKEN_PATTERN = re.compile(r"[\u0590-\u05FFa-zA-Z0-9']+")

QUOTE_TRANSLATION_TABLE = str.maketrans({
    "“": '"',
    "”": '"',
    "„": '"',
    "‟": '"',
    "’": "'",
    "‚": "'",
    "‘": "'",
    "‛": "'",
})


def strip_html(text: str) -> str:
    """Remove HTML tags while preserving spacing."""

    soup = BeautifulSoup(text, "html.parser")
    return soup.get_text(" ")


def normalize_hebrew_text(text: str | None) -> str:
    """Standardize punctuation, spaces and stray markup in Hebrew passages."""

    if not text:
        return ""

    cleaned = strip_html(str(text))
    cleaned = cleaned.translate(QUOTE_TRANSLATION_TABLE)
    cleaned = cleaned.replace("\xa0", " ").replace("\u200f", "")
    cleaned = re.sub(r"[\u202a-\u202e]", "", cleaned)  # remove directional marks
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def tokenize_for_bm25(text: str) -> List[str]:
    """Tokenize normalized Hebrew/English text for sparse retrieval."""

    normalized = normalize_hebrew_text(text).lower()
    return TOKEN_PATTERN.findall(normalized)


def pick_key_terms(tokens: Iterable[str], max_terms: int = 3) -> List[str]:
    """Select salient tokens while removing common stopwords."""

    selected: List[str] = []
    for token in tokens:
        if token in HEBREW_STOPWORDS:
            continue
        if len(token) < 3:
            continue
        if token in selected:
            continue
        selected.append(token)
        if len(selected) >= max_terms:
            break
    return selected


def build_passage_representation(url: str | None, question: str | None, answer: str | None) -> str:
    """Create a consistent textual representation of a knowledge passage."""

    normalized_question = normalize_hebrew_text(question)
    normalized_answer = normalize_hebrew_text(answer)
    normalized_url = normalize_hebrew_text(url)

    parts: list[str] = []
    if normalized_url:
        parts.append(f"כתובת: {normalized_url}")
    if normalized_question:
        parts.append(f"שאלה: {normalized_question}")
    if normalized_answer:
        parts.append(f"תשובה: {normalized_answer}")

    return "\n".join(parts)

