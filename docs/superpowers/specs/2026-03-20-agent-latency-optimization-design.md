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
- Remove the `self._client` attribute and the `OpenAI` client import
- Remove the `history` parameter from `retrieve_contexts()` — the method becomes `retrieve_contexts(self, query: str)`

**`app/services/rag_chatbot/nodes/planning.py`:**
- Update `bm25_tool_func` call site (already passes `history=[]`, but signature changes)
- Add to the `bm25_tool` description in the system prompt: instruct the LLM to always produce standalone, self-contained search queries that incorporate relevant conversation context instead of relying on pronouns or references

**`app/services/rag_chatbot/openai_client.py`:**
- Remove if no other code imports it (verify first)

### Estimated Savings

~2-4s per BM25 search x 1-3 searches = **2-12s total**

## Optimization 2: Parallel Tool Execution with Deduplication

### Problem

`planning.py:459` processes only `response.tool_calls[0]`, discarding additional tool calls. The LLM can only execute one BM25 search per round-trip, forcing sequential iterations:

```
LLM call 1 → "search X" → BM25 → LLM call 2 → "search Y" → BM25 → LLM call 3 → answer
```

Each LLM round-trip costs 3-8s. Eliminating even one saves significant time.

### Changes

**`app/services/rag_chatbot/nodes/planning.py` — tool execution refactor:**

Replace the single-tool execution block (lines ~458-670) with multi-tool processing:

1. Iterate over all `response.tool_calls`
2. Categorize: collect BM25 calls separately from terminal tools (final_answer, mcq, capability_explanation, build_ticket)
3. Apply the priority rule:
   - If ANY BM25 calls exist: execute all BM25 calls, discard terminal tools, loop back
   - If NO BM25 calls: execute the first terminal tool
4. Execute BM25 searches, merge and deduplicate results
5. Add one ToolMessage per tool call to history (each with its `tool_call_id`)

**Deduplication strategy:**

BM25 results are keyed by passage index (int). When multiple searches return overlapping passages:
- Merge into `bm25_raw_contexts` by passage index — same key = same passage, naturally deduplicates
- Build the formatted results string (`<data_N>...</data_N>`) from the merged dict, not from per-call concatenation
- Each unique passage appears exactly once, numbered sequentially
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

**Tool limit enforcement:** The global max of 5 BM25 calls still applies. Count how many are in the batch, execute up to the remaining limit, reject the rest.

**Prompt update:** Add to system prompt: *"You may call bm25_tool multiple times in a single turn with different search queries to gather information more efficiently."*

### Estimated Savings

Eliminates 1-2 full LLM round-trips = **4-12s total**

## Files Changed

| File | Change |
|---|---|
| `app/services/rag_chatbot/retriever.py` | Remove query rewrite block, OpenAI client, `history` parameter |
| `app/services/rag_chatbot/nodes/planning.py` | Parallel tool execution refactor, system prompt updates |
| `app/services/rag_chatbot/openai_client.py` | Remove if unused after retriever change |

## What Doesn't Change

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

**Streaming final answer:** Stream LLM tokens to the client as they're generated instead of buffering the full response. This would improve perceived latency by 1-2s but adds significant complexity to the node/agent architecture. Deferred until 1b+1c results are measured.
