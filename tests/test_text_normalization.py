from app.services.text_normalization import (
    build_passage_representation,
    normalize_hebrew_text,
    pick_key_terms,
    tokenize_for_bm25,
)


def test_normalize_hebrew_text_strips_html_and_collapses_spaces():
    raw = "<p>שלום&nbsp;&nbsp;עולם!</p> <br>“ציטוט”"
    normalized = normalize_hebrew_text(raw)
    assert normalized == 'שלום עולם! "ציטוט"'


def test_tokenize_for_bm25_handles_hebrew_and_english():
    text = "ניהול לקוחות CRM 2.0"
    tokens = tokenize_for_bm25(text)
    assert tokens == ["ניהול", "לקוחות", "crm", "2", "0"]


def test_pick_key_terms_removes_stopwords():
    tokens = ["מה", "המצב", "לקוחות", "של", "המערכת"]
    key_terms = pick_key_terms(tokens, max_terms=3)
    assert key_terms == ["המצב", "לקוחות", "המערכת"]


def test_build_passage_representation_includes_fields():
    passage = build_passage_representation(
        "https://example.com", "<b>איך</b> להתחיל?", "בדוק  <i>ככה</i>."
    )
    assert "כתובת: https://example.com" in passage
    assert "שאלה: איך להתחיל?" in passage
    assert "תשובה: בדוק ככה." in passage
