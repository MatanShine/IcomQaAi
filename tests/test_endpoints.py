import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def patch_services(monkeypatch):
    def fake_add_data(_):
        return 0

    def fake_rebuild(_):
        return 0

    def fake_chat(message, history=None):
        return "stubbed response"

    monkeypatch.setattr("app.services.svc.add_data", fake_add_data)
    monkeypatch.setattr("app.services.svc.rebuild_database", fake_rebuild)
    monkeypatch.setattr("app.services.svc.chat", fake_chat)


def test_create_database():
    res = client.get("/api/v1/create_database")
    assert res.status_code == 200
    assert res.json() == {"amount_added": 0}


def test_rewrite_database():
    res = client.get("/api/v1/rewrite_database")
    assert res.status_code == 200
    assert res.json() == {"amount_added": 0}


def test_chat():
    res = client.post("/api/v1/chat", json={"message": "hi", "history": []})
    assert res.status_code == 200
    assert res.json() == {"response": "stubbed response"}
