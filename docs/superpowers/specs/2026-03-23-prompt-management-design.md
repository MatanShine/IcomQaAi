# Prompt Management UI — Design Spec

**Date:** 2026-03-23
**Status:** Draft

## Overview

Add a Prompt Management page to the analytics UI that allows editing, versioning, testing, and publishing system prompts and other prompt templates used by the RAG chatbot agent. Prompts are stored in PostgreSQL alongside existing analytics data. The Python agent reads prompts directly from the database at session start.

## Goals

- Replace hardcoded prompt strings with database-backed, versioned prompts
- Enable testing new prompt versions via the Test Agent page before publishing to production
- Provide side-by-side text diff and metrics comparison between prompt versions
- Support two prompt types initially (System Prompt, Capability Explanation), extensible for more

## Non-Goals

- A/B testing across production traffic (only Test Agent page uses testing versions)
- Real-time prompt hot-reloading mid-session
- Prompt collaboration or access control (single-user editing)

---

## Architecture

### Approach: Shared DB, Split Reads/Writes

The analytics backend (Express/Prisma) owns all write operations: creating, editing, publishing, and lifecycle management of prompt versions. The Python agent reads prompt content directly from the same PostgreSQL database at session start.

```
Analytics UI (React)
    │
    ▼
Analytics Backend (Express/Prisma)  ──writes──▶  PostgreSQL
                                                     ▲
                                                     │ reads
                                                     │
                                              Python Agent (LangGraph)
```

**Why shared DB instead of API-mediated:** The agent remains self-sufficient with no network dependency on the analytics backend. If the analytics backend is down, the agent still resolves prompts. The DB is already shared between both services.

**Fallback:** If no prompt version exists in the database for a given type, the agent falls back to its hardcoded default prompt.

---

## Database Schema

### Table: `prompt_versions`

| Column       | Type        | Description                                              |
|-------------|-------------|----------------------------------------------------------|
| id          | SERIAL PK   |                                                          |
| prompt_type | VARCHAR      | `system_prompt`, `capability_explanation` (extensible)   |
| version     | INT          | Auto-incrementing per prompt_type                        |
| name        | VARCHAR      | Human-readable label (e.g., "Concise Hebrew v2")        |
| content     | TEXT         | Full prompt template text with `{variable}` placeholders |
| status      | VARCHAR      | `draft`, `testing`, `published`, `archived`              |
| created_at  | TIMESTAMP    | Creation time                                            |
| updated_at  | TIMESTAMP    | Last edit time (used for sort ordering)                  |
| published_at| TIMESTAMP    | NULL until published                                     |

**Constraints:**
- At most one `published` version per `prompt_type`
- At most one `testing` version per `prompt_type`

### Table: `prompt_test_sessions`

| Column            | Type      | Description                                    |
|-------------------|-----------|------------------------------------------------|
| id                | SERIAL PK |                                                |
| session_id        | VARCHAR   | Links to Test Agent session                    |
| prompt_type       | VARCHAR   |                                                |
| prompt_version_id | INT FK    | → prompt_versions.id                           |
| created_at        | TIMESTAMP |                                                |

Records which prompt version was used in each Test Agent session, enabling per-version metrics calculation.

---

## Version Lifecycle

```
Draft ──Set as Testing──▶ Testing ──Publish──▶ Published ──(auto)──▶ Archived
  ▲                          │                      │                     │
  │        Stop Test ────────┘                      │                     │
  │                                                 │                     │
  └──────────── Clone as Draft ─────────────────────┴─────────────────────┘
```

**Shortcut:** Draft can be published directly, skipping the testing phase.

### Status Rules

| Status    | Editable? | Actions Available                    | Metrics Source                  |
|-----------|-----------|--------------------------------------|---------------------------------|
| draft     | Yes       | Set as Testing, Publish, Save        | None                            |
| testing   | Yes       | Stop Test, Publish, Save             | Test Agent sessions only        |
| published | No        | Clone as Draft                       | All production sessions         |
| archived  | No        | Clone as Draft                       | Historical (when it was active) |

### Lifecycle Operations

- **Publish:** Sets version to `published`. The previously published version of the same `prompt_type` is automatically set to `archived`.
- **Set as Testing:** Sets version to `testing`. Any other `testing` version of the same `prompt_type` is returned to `draft`.
- **Stop Test:** Returns version to `draft`. Test Agent falls back to using the `published` version.
- **Clone as Draft:** Creates a new draft version with the content copied from the source version.

---

## Analytics Backend API

### CRUD

- `GET /api/prompts?type=<prompt_type>` — List all versions for a prompt type
- `GET /api/prompts/:id` — Get a single version with full content
- `POST /api/prompts` — Create a new draft: `{ prompt_type, name, content }`
- `PUT /api/prompts/:id` — Update a draft's name/content (only drafts and testing versions are editable)

### Lifecycle Actions

- `POST /api/prompts/:id/publish` — Publish version (auto-archives previous published)
- `POST /api/prompts/:id/test` — Set version as testing
- `POST /api/prompts/:id/stop-test` — Return testing version to draft

### Comparison

- `GET /api/prompts/compare?ids=<id1>,<id2>` — Returns metrics for any two prompt versions side by side. Pulls data from `customer_support_chatbot_ai` + `support_requests` tables joined through `prompt_test_sessions`. Supports comparing any combination (published vs testing, published vs archived, etc.).

### Seed

- `POST /api/prompts/seed` — One-time utility to create initial `published` versions from the current hardcoded prompts. Idempotent (skips if published versions already exist).

---

## Agent-Side Integration

### Prompt Resolution

New utility in `app/services/rag_chatbot/`:

```
resolve_prompt(prompt_type: str, is_test_session: bool = False) -> str
```

- If `is_test_session=True`: returns the `testing` version content, falling back to `published` if none exists
- If `is_test_session=False`: returns the `published` version content
- If no version exists in DB: returns the hardcoded default prompt

### Test Session Detection

- The Test Agent page already sends `POST /api/agent/chat` with `{ message, session_id }`
- Add `is_test: true` to the payload
- The analytics backend proxy passes it through to the Python app
- The agent checks this flag when calling `resolve_prompt`

### Where Prompts Are Replaced

- `planning.py` — `think_node` replaces hardcoded `system_prompt` f-string with `resolve_prompt("system_prompt", is_test)`
- `retrieval_and_answer.py` — `capability_explanation_node` replaces hardcoded prompt with `resolve_prompt("capability_explanation", is_test)`

### Session Tracking

When a prompt is resolved for a test session, the agent writes a record to `prompt_test_sessions` to enable metrics correlation.

### Caching

Prompts are cached in-memory with a 60-second TTL, keyed by `(prompt_type, status)`. This avoids a DB query on every request while ensuring new versions are picked up within a minute. No active cache-bust mechanism is needed — the 60-second propagation delay on publish/status changes is acceptable.

### Database Models

Both a **Prisma migration** (for the analytics backend to write) and a **SQLAlchemy model** (for the Python agent to read) are needed for the new tables, since each service uses its own ORM against the shared PostgreSQL database.

---

## Analytics UI — Prompt Management Page

### Layout: List-Detail

A new page accessible from the sidebar navigation ("Prompt Management").

**Left panel — Tree sidebar:**
- Prompt types as collapsible groups (System Prompt, Capability Explanation)
- Versions listed under each group
- Sort order: published (pinned top) → testing (pinned second) → all others by `updated_at` desc
- Each version shows: name, status badge, relative timestamp

**Right panel — Detail area:**
- Header: breadcrumb (prompt type / version name), status badge, action buttons
- Editor: monospace dark-themed text area, read-only for published/archived, editable for draft/testing
- Variable highlighting section (below editor)
- Performance metrics (below variables)

### Comparison Interaction

- Hovering a version in the tree shows a **+** icon on its left side (only when fewer than 2 versions are selected for comparison)
- Clicking **+** selects the version for comparison — the **+** icon stays locked/visible
- Hovering over an already-selected version turns the **+** into a **-**
- Clicking **-** removes it from comparison
- When 2 versions are selected: the detail panel switches to a side-by-side view with text diff (red = removed, green = added) and a metrics comparison table with a diff column
- Deselecting one version returns to the single-version detail view

### Variable Highlighting

**In the editor:**
- Known template variables (e.g., `{kb_context}`) are detected and rendered with a colored background pill
- Blue pill: variable appears exactly once in the prompt
- Yellow pill: variable appears more than once
- Unknown `{text}` patterns that don't match registered variables are left plain

**Below the editor — variable list:**
- All available variables for the current prompt type are displayed as chips
- Color coding: grey = not used in prompt (count 0), blue = used once, yellow = used more than once
- Each chip has a count badge showing the number of occurrences
- Hover shows a tooltip with the exact count
- Clicking a variable in the list scrolls to and highlights its occurrences in the editor

**Legend:** A small legend below the variable chips explains the color coding.

### Action Buttons by Status

| Status    | Buttons                              |
|-----------|--------------------------------------|
| draft     | Set as Testing, Publish, Save        |
| testing   | Stop Test, Publish, Save             |
| published | Clone as Draft                       |
| archived  | Clone as Draft                       |

### Performance Metrics

**Single version view:** Metrics bar below the editor showing IDK Rate, Escalation Rate, Avg Duration, Avg Questions/Session, Avg Tokens, and session count. Empty state for drafts: "No metrics yet — set as testing and use Test Agent to generate data."

**Comparison view:** Table with columns: Metric, Version A (with status), Version B (with status), Diff. Includes a warning when sample size is small. Metrics calculated by joining `customer_support_chatbot_ai` and `support_requests` through `prompt_test_sessions`.

---

## Template Variables

The system prompt uses dynamic template variables that are injected at runtime. These are registered in the system so the UI can highlight them:

### System Prompt Variables

| Variable               | Description                                              |
|------------------------|----------------------------------------------------------|
| `{question_titles_text}` | List of knowledge base question titles                 |
| `{kb_context}`          | BM25 retrieval results from knowledge base              |
| `{previous_queries}`    | Search queries made earlier in the session               |
| `{tool_usage_counts}`   | Current count of each tool used in the session           |
| `{tool_limits}`         | Maximum allowed uses per tool                            |

### Capability Explanation Variables

| Variable               | Description                                              |
|------------------------|----------------------------------------------------------|
| `{conversation_text}`   | Formatted conversation history                          |

Variable registration is stored as configuration (not in the database) since it maps to agent code and changes infrequently.

---

## Sidebar Navigation

Add "Prompt Management" to the existing sidebar in `Layout.tsx`, positioned between "Knowledge Base" and "Test Agent" in the navigation order.

Route: `/prompt-management`

---

## Test Agent Page Changes

- Add `is_test: true` to the chat request payload
- No other UI changes needed — the Test Agent page automatically uses the testing prompt version when one is set

---

## Seed Strategy

On first deployment, run `POST /api/prompts/seed` to:
1. Extract current hardcoded system prompt from `planning.py` and create a `published` version
2. Extract current hardcoded capability explanation prompt from `retrieval_and_answer.py` and create a `published` version

This ensures the system starts with working prompts and the transition from hardcoded to DB-backed is seamless.

---

## Mockups

Visual wireframes are available in `.superpowers/brainstorm/24818-1774295914/`:
- `prompt-management-full-design.html` — All four views (single version, draft editing, comparison, testing version) plus action table and lifecycle flow
- `prompt-management-tweaks.html` — Variable highlighting detail and list ordering
