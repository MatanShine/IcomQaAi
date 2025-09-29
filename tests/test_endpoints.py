import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB_PATH = Path("test.db")
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"

from app.main import app
from app.models.db import (
    CustomerSupportChatbotAI,
    SessionLocal,
    SupportRequest,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def patch_services(monkeypatch):
    def fake_add_data(db, logger):
        return 0

    def fake_rebuild(*_):
        return 0

    def fake_chat(bot, message, history=None):
        return "stubbed response", "retrieved", 0, 0

    monkeypatch.setattr("app.services.svc.add_data", fake_add_data)
    monkeypatch.setattr("app.services.svc.rebuild_database", fake_rebuild)
    monkeypatch.setattr("app.services.svc.chat", fake_chat)


@pytest.fixture(autouse=True)
def clean_database():
    with SessionLocal() as session:
        session.query(SupportRequest).delete()
        session.query(CustomerSupportChatbotAI).delete()
        session.commit()
    yield
    with SessionLocal() as session:
        session.query(SupportRequest).delete()
        session.query(CustomerSupportChatbotAI).delete()
        session.commit()


def test_add_new_data():
    res = client.get("/api/v1/add_new_data")
    assert res.status_code == 200
    assert res.json() == {"amount_added": 0}


def test_chat():
    res = client.post("/api/v1/chat", json={"message": "hi", "history": [], "session_id": "abc"})
    assert res.status_code == 200
    assert res.json() == {"response": "stubbed response"}


def test_open_support_request_counts_messages():
    session_id = "abc"
    with SessionLocal() as session:
        session.add_all(
            [
                CustomerSupportChatbotAI(
                    question="q1",
                    answer="a1",
                    context="ctx",
                    history="[]",
                    tokens_sent=1,
                    tokens_received=2,
                    session_id=session_id,
                ),
                CustomerSupportChatbotAI(
                    question="q2",
                    answer="a2",
                    context="ctx",
                    history="[]",
                    tokens_sent=1,
                    tokens_received=2,
                    session_id=session_id,
                ),
            ]
        )
        session.commit()

    res = client.post("/api/v1/open_support_request", json={"session_id": session_id})
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == session_id
    assert data["message_amount"] == 2
    assert isinstance(data["id"], int)
    assert data["date_added"] is not None
