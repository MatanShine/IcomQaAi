from __future__ import annotations

import json
import logging
from types import SimpleNamespace

import pytest

from app.core.config import SYSTEM_INSTRUCTION
from app.services.rag_chatbot import manager
from app.services.rag_chatbot.manager import RAGChatbot
from app.services.rag_chatbot.openai_client import OpenAIChatClient
from app.services.rag_chatbot.prompt_builder import PromptBuilder
from app.services.rag_chatbot.retriever import BM25Retriever


class _FakeQuery:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _FakeDB:
    def __init__(self, items):
        self._items = items

    def query(self, model):  # pragma: no cover - simple passthrough
        return _FakeQuery(self._items)


class _FakeItem:
    def __init__(self, question: str, answer: str, url: str, item_id: int):
        self.question = question
        self.answer = answer
        self.url = url
        self.id = item_id


def test_prompt_builder_creates_expected_json():
    builder = PromptBuilder(SYSTEM_INSTRUCTION, max_history_messages=2)
    prompt = builder.build_prompt(["hello", "world"], "question?", "context")

    payload = json.loads(prompt)
    assert payload["instructions"] == SYSTEM_INSTRUCTION
    assert payload["conversation_history"].startswith("[User: hello\nAssistant: world")
    assert payload["user_question"] == "question?"
    assert payload["retrieved_context_from_manual"] == "context"


def test_bm25_retriever_returns_context(tmp_path):
    logger = logging.getLogger("test-bm25")
    items = [
        _FakeItem("What is Zebra?", "Zebra is great.", "https://example.com/1", 1),
        _FakeItem("How to login?", "Use your credentials.", "https://example.com/2", 2),
    ]
    db = _FakeDB(items)
    index_path = tmp_path / "index.json"

    retriever = BM25Retriever(logger, db, str(index_path), top_k=1)
    context, id_map = retriever.retrieve_contexts("login")

    assert "Use your credentials." in context
    assert id_map == {2: "https://example.com/2"}
    assert index_path.exists()


def test_openai_chat_client_chat_and_stream(monkeypatch):
    import app.services.rag_chatbot.openai_client as openai_client_module

    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=5)
    chat_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=" hi "))],
        usage=usage,
    )
    stream_chunks = [
        SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="Hello"))],
            usage=None,
        ),
        SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content=""))],
            usage=usage,
        ),
    ]

    class _FakeCompletions:
        def create(self, **kwargs):
            if kwargs.get("stream"):
                return iter(stream_chunks)
            return chat_response

    class _FakeChat:
        def __init__(self):
            self.completions = _FakeCompletions()

    class _FakeOpenAI:
        def __init__(self, api_key=None):
            self.chat = _FakeChat()

    monkeypatch.setattr(openai_client_module, "OpenAI", _FakeOpenAI)
    monkeypatch.setattr(openai_client_module.settings, "openai_api_key", "test-key", raising=False)

    logger = logging.getLogger("test-openai-client")
    client = OpenAIChatClient(logger)

    answer, prompt_tokens, completion_tokens = client.chat("prompt")
    assert answer == "hi"
    assert prompt_tokens == 10
    assert completion_tokens == 5

    chunks = list(client.stream_chat("prompt"))
    assert chunks[0] == ("Hello", 0, 0)
    assert chunks[-1] == (None, 10, 5)


@pytest.mark.asyncio
async def test_rag_chatbot_delegates_to_components(monkeypatch):
    events: dict[str, object] = {}

    class _FakeRetriever:
        def __init__(self, logger, db, index_path, top_k):
            events["retriever_init"] = (index_path, top_k)

        def retrieve_contexts(self, query):
            events["retrieve"] = query
            return "ctx", {7: "https://example.com"}

    class _FakePromptBuilder:
        def __init__(self, instructions, max_history_messages):
            events["prompt_init"] = max_history_messages

        def build_prompt(self, history, message, context):
            events["build"] = (list(history), message, context)
            return "prompt"

    class _FakeOpenAIClient:
        def __init__(self, logger):
            pass

        def chat(self, prompt):
            events["chat"] = prompt
            return "answer\nSource ID: 7", 1, 2

        def stream_chat(self, prompt):
            events["stream"] = prompt
            yield "answer\nSource ID: 7", 0, 0
            yield None, 3, 4

    monkeypatch.setattr(manager, "BM25Retriever", _FakeRetriever)
    monkeypatch.setattr(manager, "PromptBuilder", _FakePromptBuilder)
    monkeypatch.setattr(manager, "OpenAIChatClient", _FakeOpenAIClient)

    bot = RAGChatbot(logging.getLogger("test-rag"), db=object(), index_path="path", max_history_messages=5, top_k=2)

    response = bot.chat("message", ["h1"])
    assert response == ("answer\nSource ID: 7\nlink: https://example.com", "ctx", 1, 2)
    assert events["retrieve"] == "message"
    assert events["build"] == (["h1"], "message", "ctx")
    assert events["chat"] == "prompt"

    chunks = []
    async for chunk in bot.stream_chat("message", ["h1"]):
        chunks.append(chunk)

    assert chunks == [
        ("answer\nSource ID: 7", None, 0, 0),
        ("\nlink: https://example.com", None, 3, 4),
        (None, "ctx", 3, 4),
    ]
    assert events["stream"] == "prompt"
