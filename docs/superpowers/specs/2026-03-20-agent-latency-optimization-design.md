# Agent Latency Optimization Design

**Date:** 2026-03-20
**Goal:** Reduce agent wall-clock response time by at least 50% (from 25-50s to ~10-20s)

## Context

The RAG chatbot agent uses a LangGraph tool-calling loop where `think_node` invokes an LLM (gpt-5-nano) that decides which tool to call (BM25 search, MCQ, final_answer, capability_explanation, build_ticket). Each iteration is a full LLM round-trip (3-8s). A typical question requires 3-5 sequential round-trips, producing 25-50s total latency.

Two independent optimizations target the two biggest latency sources: hidden LLM calls and sequential tool execution.

## Optimization 1: Eliminate Query-Rewrite LLM Call

### Problem

`retriever.py:57-73` makes a synchronous OpenAI API call to rewrite the user's query into a standalone search query whenever conversation history is non-empty. This adds ~2-4s per BM25 search, and the agent can make up to 5 searches per user input.

The think_node LLM already has the full conversation history and is responsible for crafting the BM25 search query. The rewrite call in the retriever is redundant.

### Changes

**`app/services/rag_chatbot/retriever.py`:**
- Remove the `if history != []:` block (lines 57-73) that calls `self._client.responses.create()` for query rewriting
- Remove the `self._client` attribute and the `OpenAI` client import (line 12, line 46)
- Remove unused imports that become dead code after removal: `settings` and `MODEL` from `app.core.config` (line 13)
- Remove the `history` parameter from `retrieve_contexts()` — the method becomes `retrieve_contexts(self, query: str)`

**`app/services/rag_chatbot/manager.py`:**
- `manager.py` is the legacy (non-agent) chatbot path. It calls `retrieve_contexts(message, history)` at lines 36 and 47.
- Update both call sites to drop the `history` argument: `self.retriever.retrieve_contexts(message)`
- The legacy path loses history-aware query rewriting. This is acceptable because: (1) the agent path (`/chat/agent`) is the primary path being optimized, and (2) the legacy path's query rewriting was a best-effort improvement, not a critical feature. If needed in the future, query rewriting can be added at the `manager.py` level.

**`app/services/rag_chatbot/nodes/planning.py`:**
- Update `bm25_tool_func` call site (already passes `history=[]`, update to drop the parameter)
- Add to the `bm25_tool` description in the system prompt: instruct the LLM to always produce standalone, self-contained search queries that incorporate relevant conversation context instead of relying on pronouns or references

**`app/services/rag_chatbot/openai_client.py`:**
- Do NOT remove — still used by `manager.py` (imports `OpenAIChatClient`) and `tests/test_rag_components.py`. Only the retriever's dependency on it is removed.

### Estimated Savings

~2-4s per BM25 search x 1-3 searches = **2-12s total**

## Optimization 2: Batched Tool Execution with Deduplication

### Problem

`planning.py:459` processes only `response.tool_calls[0]`, discarding additional tool calls. The LLM can only execute one BM25 search per round-trip, forcing sequential iterations:

```
LLM call 1 → "search X" → BM25 → LLM call 2 → "search Y" → BM25 → LLM call 3 → answer
```

Each LLM round-trip costs 3-8s. Eliminating even one saves significant time.

Note: "batched" not "parallel" — BM25 is CPU-bound (NumPy via `BM25Okapi.get_scores`) and shares an in-memory index, so the searches execute sequentially within the same `think_node` invocation. The latency savings come from eliminating LLM round-trips between searches, not from I/O parallelism.

### Changes

**`app/services/rag_chatbot/nodes/planning.py` — tool execution refactor:**

Replace the single-tool execution block (lines ~458-670) with multi-tool processing:

1. Iterate over all `response.tool_calls`
2. Categorize: collect BM25 calls separately from terminal tools (final_answer, mcq, capability_explanation, build_ticket)
3. Apply the priority rule:
   - If ANY BM25 calls exist: execute all BM25 calls (up to remaining limit), discard terminal tools, loop back
   - If NO BM25 calls: execute the first terminal tool
4. Execute BM25 searches sequentially, merge and deduplicate results
5. Construct history messages in correct order: `[response_AIMessage, tool_message_1, tool_message_2, ...]` — the single AIMessage contains all `tool_calls` in its metadata, each ToolMessage references its specific `tool_call_id`

**Enable parallel tool calls in LLM binding:**
- Explicitly set `parallel_tool_calls=True` in `llm.bind_tools(tools, parallel_tool_calls=True)` to ensure the LLM is allowed to emit multiple tool calls per response. This is the default for OpenAI models but should be set explicitly.

**Deduplication strategy:**

BM25 results are keyed by passage index (int from `retrieve_contexts()`). When multiple searches return overlapping passages:
- Merge into `bm25_raw_contexts` using **string keys** (matching the existing `str(key)` conversion at line 518) — same string key = same passage, naturally deduplicates
- Build the formatted results string (`<data_N>...</data_N>`) from the merged dict, not from per-call concatenation
- Each unique passage appears exactly once, numbered sequentially
- **Cap merged results at `top_k` (5)** to match the system prompt's claim of "up to 5 results" and avoid overwhelming the LLM context. If more than 5 unique passages exist, keep the 5 with highest BM25 scores across all searches.
- Store one merged entry in `bm25_results` per think_node iteration

**Edge case handling:**

| Combination | Handling | Rationale |
|---|---|---|
| Multiple BM25 only | Execute all, merge, dedupe, loop back | Happy path |
| BM25 + final_answer | Execute BM25, discard final_answer, loop back | Answer was generated without seeing new results |
| BM25 + mcq | Execute BM25, discard mcq, loop back | MCQ options should reflect search results |
| BM25 + capability_explanation | Execute BM25, discard capability_explanation, loop back | Results might prove question is in scope |
| BM25 + build_ticket | Execute BM25, discard build_ticket, loop back | Let LLM reconsider with full context |
| Single terminal tool (no BM25) | Execute normally | Current behavior preserved |
| Multiple terminal tools (no BM25) | Execute first one only | Shouldn't happen, safe fallback |

**Tool limit enforcement:**
- The global max of 5 BM25 calls still applies. Count how many are in the batch, execute up to the remaining limit.
- **Rejected BM25 calls** (those exceeding the limit): still add a ToolMessage for each with content `"BM25 search limit reached (5/5)"` and the corresponding `tool_call_id`. The LLM expects a response for every `tool_call_id` it emitted — missing responses cause undefined behavior in the tool-calling protocol.
- **Empty batch after enforcement**: if ALL BM25 calls in a batch are rejected (remaining limit = 0) and terminal tools were discarded, fall back to forcing `final_answer_tool` — same as the current behavior when bm25 limit is reached (line 474-488).

**Prompt update:** Add to system prompt: *"You may call bm25_tool multiple times in a single turn with different search queries to gather information more efficiently."*

### Estimated Savings

Eliminates 1-2 full LLM round-trips = **4-12s total**

## Files Changed

| File | Change |
|---|---|
| `app/services/rag_chatbot/retriever.py` | Remove query rewrite block, OpenAI client, unused imports, `history` parameter |
| `app/services/rag_chatbot/nodes/planning.py` | Batched tool execution refactor, system prompt updates, `parallel_tool_calls=True` |
| `app/services/rag_chatbot/manager.py` | Update two `retrieve_contexts` call sites to drop `history` argument |

## What Doesn't Change

- `openai_client.py` — still used by `manager.py` and tests
- Graph structure (`agent.py`), state schema (`state.py`), streaming loop, endpoint
- All other nodes: `mcq_response_node`, `capability_explanation_node`, `build_ticket_node`, `build_ticket_or_start_router_node`
- Tool limits (5 BM25, 1 MCQ, 1 final_answer, 1 capability_explanation, 1 build_ticket)
- BM25 retriever core logic (tokenization, scoring, passage loading)
- Database schema and recording

## Expected Result

- Current latency: 25-50s
- After optimization: ~10-20s (50-60% reduction)
- Combined savings: 6-24s from eliminating hidden LLM calls and reducing sequential round-trips

## Future Consideration (Deferred)

**Streaming final answer:** Stream LLM tokens to the client as they're generated instead of buffering the full response. This would improve perceived latency by 1-2s but adds significant complexity to the node/agent architecture. Deferred until optimizations 1+2 results are measured.
