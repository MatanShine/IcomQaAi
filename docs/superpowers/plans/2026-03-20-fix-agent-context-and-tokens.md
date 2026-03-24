# Fix Agent Context & Token Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/chat/agent` endpoint store BM25 retrieval context and LLM token usage in the database, matching what `/chat` and `/chat/stream` already do.

**Architecture:** Data flows from agent nodes → AgentState → agent.stream() "done" event → endpoint DB save. We add three new state fields (`bm25_raw_contexts`, `total_tokens_sent`, `total_tokens_received`), populate them inside the nodes that call BM25/LLM, surface them in the "done" yield, and consume them in the endpoint.

**Tech Stack:** Python, LangGraph, LangChain (ChatOpenAI), FastAPI, SQLAlchemy, PostgreSQL

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/services/rag_chatbot/state.py` | Modify | Add 3 new fields to AgentState TypedDict |
| `app/services/rag_chatbot/nodes/planning.py` | Modify | Capture raw BM25 contexts + LLM token usage in think_node (including build_ticket_tool_func) |
| `app/services/rag_chatbot/nodes/retrieval_and_answer.py` | Modify | Capture LLM token usage in capability_explanation_node and build_ticket_node |
| `app/services/rag_chatbot/agent.py` | Modify | Yield metadata dict with all 4 "done" events instead of empty string |
| `app/api/v1/endpoints.py` | Modify | Use metadata from "done" event for DB save in agent_stream and _open_ticket_generator |

---

## Token extraction helper

All nodes need the same logic to extract tokens from a LangChain AIMessage. `usage_metadata` is a dict/TypedDict, so use `.get()` not `getattr()`:

```python
def _extract_tokens(response) -> tuple[int, int]:
    """Extract (input_tokens, output_tokens) from a LangChain AIMessage response."""
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
```

This helper will be placed in `app/services/rag_chatbot/utils.py` and imported where needed.

---

### Task 1: Add token extraction helper to utils.py

**Files:**
- Modify: `app/services/rag_chatbot/utils.py` (append at end)

- [ ] **Step 1: Add the helper function at the end of utils.py**

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add app/services/rag_chatbot/utils.py
git commit -m "feat: add extract_llm_token_usage helper to utils"
```

---

### Task 2: Add new fields to AgentState

**Files:**
- Modify: `app/services/rag_chatbot/state.py:8-18`

- [ ] **Step 1: Add three fields to AgentState**

Add after line 15 (`bm25_results`):

```python
    bm25_raw_contexts: dict  # Raw retrieval context {str(id): [question, answer, url]} for DB storage
    total_tokens_sent: int  # Accumulated prompt/input tokens across all LLM calls
    total_tokens_received: int  # Accumulated completion/output tokens across all LLM calls
```

- [ ] **Step 2: Commit**

```bash
git add app/services/rag_chatbot/state.py
git commit -m "feat: add context and token tracking fields to AgentState"
```

---

### Task 3: Capture raw BM25 contexts and LLM tokens in think_node

**Files:**
- Modify: `app/services/rag_chatbot/nodes/planning.py`

There are three changes in this file:

**Change A — Initialize new state fields and capture LLM token usage**

- [ ] **Step 1: Add import for the token helper at the top of the file**

Add to the imports from utils (line 11):

```python
from app.services.rag_chatbot.utils import (
    get_last_user_message,
    get_message_content,
    create_llm,
    extract_llm_token_usage,
)
```

- [ ] **Step 2: Initialize new state fields in think_node after line 188**

After the existing `bm25_results` initialization (line 188), add:

```python
    bm25_raw_contexts: Dict = state.setdefault("bm25_raw_contexts", {})
    total_tokens_sent: int = state.get("total_tokens_sent", 0)
    total_tokens_received: int = state.get("total_tokens_received", 0)
```

- [ ] **Step 3: Extract token usage from LLM response after line 433**

Right after `response = llm_with_tools.invoke(llm_messages)` (line 433), add:

```python
        # Accumulate token usage from LLM response
        sent, received = extract_llm_token_usage(response)
        total_tokens_sent += sent
        total_tokens_received += received
        state["total_tokens_sent"] = total_tokens_sent
        state["total_tokens_received"] = total_tokens_received
```

**Change B — Capture raw BM25 context inside bm25_tool execution**

- [ ] **Step 4: Change bm25_tool_func to also return raw contexts**

Replace the `bm25_tool_func` function (lines 275-296) with:

```python
    def bm25_tool_func(query: str) -> tuple[str, dict]:
        """Search the knowledge base with a query. Returns formatted results and raw contexts."""
        retriever = _get_shared_retriever(logger)
        try:
            contexts = retriever.retrieve_contexts(query, history=[])
        except (AttributeError, ValueError) as e:
            logger.warning(f"bm25_tool: Retriever error: {e}")
            contexts = {}
        except Exception as e:
            logger.error(f"bm25_tool: Unexpected error: {e}", exc_info=True)
            contexts = {}

        formatted_results = []
        if contexts:
            for idx, (q, a, url) in enumerate(contexts.values(), 1):
                formatted_results.append(f"<data_{idx}>\nQuestion: {q}\nAnswer: {a}\n</data_{idx}>")
        else:
            formatted_results.append("<data_1>No results found</data_1>")

        return "\n".join(formatted_results), contexts
```

Note: This function is only called directly (line 493), never through the StructuredTool wrapper. The StructuredTool registration (line 392) is only used for `llm.bind_tools()` schema generation — it does NOT invoke the function. So the return type change is safe.

- [ ] **Step 5: Update the bm25_tool execution block to unpack the new return value**

In the `if tool_name == "bm25_tool":` block (line 488), replace line 493:

```python
                result_text = bm25_tool_func(query)
```

with:

```python
                result_text, raw_contexts = bm25_tool_func(query)
                # Merge raw contexts for DB storage (keyed by passage index, deduplicates across calls)
                for key, value in raw_contexts.items():
                    bm25_raw_contexts[str(key)] = list(value)
                state["bm25_raw_contexts"] = bm25_raw_contexts
```

**Change C — Track tokens in build_ticket_tool_func**

- [ ] **Step 6: Add token tracking inside build_ticket_tool_func**

In `build_ticket_tool_func()` (line 331), after `response = ticket_llm.invoke(...)` on line 363, add:

```python
            # Accumulate token usage from ticket LLM call
            sent, received = extract_llm_token_usage(response)
            nonlocal total_tokens_sent, total_tokens_received
            total_tokens_sent += sent
            total_tokens_received += received
            state["total_tokens_sent"] = total_tokens_sent
            state["total_tokens_received"] = total_tokens_received
```

Place this right after line 364 (`ticket_json = response.content.strip()`), inside the `try:` block.

- [ ] **Step 7: Commit**

```bash
git add app/services/rag_chatbot/nodes/planning.py
git commit -m "feat: capture BM25 raw contexts and LLM token usage in think_node"
```

---

### Task 4: Track LLM token usage in capability_explanation_node and build_ticket_node

**Files:**
- Modify: `app/services/rag_chatbot/nodes/retrieval_and_answer.py:14-171`

- [ ] **Step 1: Add import for the token helper**

Add `extract_llm_token_usage` to the existing import from utils (line 6):

```python
from app.services.rag_chatbot.utils import get_message_content, create_llm, extract_llm_token_usage
```

- [ ] **Step 2: Add token tracking to build_ticket_node**

In `build_ticket_node` (line 14), after `response = ticket_llm.invoke(...)` on line 56 and `ticket_json = response.content.strip()` on line 57, add:

```python
        # Accumulate token usage
        sent, received = extract_llm_token_usage(response)
        state["total_tokens_sent"] = state.get("total_tokens_sent", 0) + sent
        state["total_tokens_received"] = state.get("total_tokens_received", 0) + received
```

- [ ] **Step 3: Add token tracking to capability_explanation_node**

In `capability_explanation_node` (line 112), after `response = llm.invoke(...)` on line 145 and `capability_message = response.content.strip()` on line 146, add:

```python
        # Accumulate token usage
        sent, received = extract_llm_token_usage(response)
        state["total_tokens_sent"] = state.get("total_tokens_sent", 0) + sent
        state["total_tokens_received"] = state.get("total_tokens_received", 0) + received
```

Place this between line 146 and line 147 (`except Exception:`).

- [ ] **Step 4: Commit**

```bash
git add app/services/rag_chatbot/nodes/retrieval_and_answer.py
git commit -m "feat: track LLM token usage in capability_explanation and build_ticket nodes"
```

---

### Task 5: Yield metadata with "done" event from agent.stream()

**Files:**
- Modify: `app/services/rag_chatbot/agent.py` — lines 245, 291, 302, 431

There are **4** places that yield `("done", "")`. All must yield a dict for consistent type handling.

- [ ] **Step 1: Create a helper method in the Agent class to build done metadata**

Add this method to the `Agent` class (e.g. after `_build_graph`):

```python
    def _get_done_metadata(self, config: dict) -> dict:
        """Collect metadata from final graph state for DB storage."""
        metadata = {}
        try:
            snapshot = self.graph.get_state(config)
            if snapshot and hasattr(snapshot, "values") and snapshot.values:
                vals = snapshot.values
                metadata["bm25_raw_contexts"] = vals.get("bm25_raw_contexts", {})
                metadata["total_tokens_sent"] = vals.get("total_tokens_sent", 0)
                metadata["total_tokens_received"] = vals.get("total_tokens_received", 0)
        except Exception as e:
            self.logger.warning(f"Could not read final state for metadata: {e}")
        return metadata
```

- [ ] **Step 2: Replace all 4 yield ("done", "") calls**

Line 245 (early exit when run_input is None):
```python
            yield ("done", self._get_done_metadata(config))
```

Line 291 (MCQ checkpoint):
```python
                            yield ("done", self._get_done_metadata(config))
```

Line 302 (capability explanation checkpoint):
```python
                            yield ("done", self._get_done_metadata(config))
```

Line 431 (normal completion at end of while loop):
```python
        yield ("done", self._get_done_metadata(config))
```

- [ ] **Step 3: Commit**

```bash
git add app/services/rag_chatbot/agent.py
git commit -m "feat: include context and token metadata in all agent done events"
```

---

### Task 6: Use metadata for DB save in endpoints

**Files:**
- Modify: `app/api/v1/endpoints.py:397-420` (agent_stream) and `app/api/v1/endpoints.py:299-323` (_open_ticket_generator)

- [ ] **Step 1: Add import for token helper at the top**

Add to the imports:

```python
from app.services.rag_chatbot.utils import extract_llm_token_usage
```

- [ ] **Step 2: Update the "done" handler in agent_stream's event_generator**

Replace the `elif event_type == "done":` block (lines 397-420):

```python
                elif event_type == "done":
                    # After response is complete, save to database
                    answer = "".join(full_answer)

                    # Extract metadata from agent (context + tokens)
                    agent_context = {}
                    agent_tokens_sent = 0
                    agent_tokens_received = 0
                    if isinstance(data, dict):
                        agent_context = data.get("bm25_raw_contexts", {})
                        agent_tokens_sent = data.get("total_tokens_sent", 0)
                        agent_tokens_received = data.get("total_tokens_received", 0)

                    # Save to database
                    db.add(
                        CustomerSupportChatbotAI(
                            question=req.message,
                            answer=answer,
                            context=json.dumps(agent_context, ensure_ascii=False),
                            history=json.dumps(history),
                            tokens_sent=agent_tokens_sent,
                            tokens_received=agent_tokens_received,
                            session_id=req.session_id,
                            theme=theme,
                            duration=(datetime.now() - start_time).total_seconds(),
                            user_id=user_id,
                            date_asked=datetime.now(),
                        )
                    )

                    db.commit()
                    # Send final completion message
                    yield "data: {}\n\n"
```

- [ ] **Step 3: Update _open_ticket_generator to track token usage**

In `_open_ticket_generator` (line 263), after `response = llm.invoke(...)` on line 299, add:

```python
        ticket_tokens_sent, ticket_tokens_received = extract_llm_token_usage(response)
```

Then in the `db.add(...)` call (line 318), replace `tokens_sent=0, tokens_received=0,` with:

```python
            tokens_sent=ticket_tokens_sent, tokens_received=ticket_tokens_received,
```

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/endpoints.py
git commit -m "feat: store agent BM25 context and token usage in database"
```

---

### Task 7: Smoke test

- [ ] **Step 1: Verify the app starts without errors**

```bash
cd /Users/matan.sheinberg/icom/IcomQaAi && python -c "from app.services.rag_chatbot.state import AgentState; print('State OK:', list(AgentState.__annotations__.keys()))"
```

Expected: prints the state keys including `bm25_raw_contexts`, `total_tokens_sent`, `total_tokens_received`

- [ ] **Step 2: Verify endpoint module imports cleanly**

```bash
python -c "from app.api.v1.endpoints import router; print('Endpoints OK')"
```

Expected: `Endpoints OK`

- [ ] **Step 3: Run existing tests**

```bash
pytest tests/ -v --tb=short 2>&1 | tail -20
```

Expected: existing tests still pass

- [ ] **Step 4: Commit any fixes if needed**
