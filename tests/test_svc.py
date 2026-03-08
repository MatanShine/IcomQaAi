"""Tests for svc.py discovery functions."""
import logging

from app.services.svc import _scrape_by_types

logger = logging.getLogger("test-svc")


def test_scrape_by_types_unknown_type():
    """Unknown types should be skipped without error."""
    result = _scrape_by_types(logger, ["unknown_type"])
    assert result == []


def test_scrape_by_types_empty_list():
    """Empty types list should return empty results."""
    result = _scrape_by_types(logger, [])
    assert result == []
