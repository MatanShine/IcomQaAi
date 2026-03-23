# Prompt Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Prompt Management page to the analytics UI for versioning, testing, and publishing system prompts used by the RAG chatbot agent.

**Architecture:** Shared PostgreSQL DB — analytics backend (Express/Prisma) handles all writes, Python agent (LangGraph/SQLAlchemy) reads prompts directly. New React page with tree sidebar, code editor, variable highlighting, and comparison view.

**Tech Stack:** React 18, TanStack Query, TailwindCSS, Express, Prisma, Zod, SQLAlchemy, Python 3

**Spec:** `docs/superpowers/specs/2026-03-23-prompt-management-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `analytics/backend/src/db/promptQueries.ts` | All prompt-related DB queries (CRUD, lifecycle, comparison metrics) |
| `analytics/backend/src/services/promptService.ts` | Prompt business logic — lifecycle transitions, seed logic |
| `analytics/backend/src/routes/prompts.ts` | Express routes for `/api/prompts` endpoints with Zod validation |
| `app/services/rag_chatbot/prompt_resolver.py` | `resolve_prompt()` with in-memory TTL cache, DB reads via SQLAlchemy |
| `analytics/frontend/src/hooks/usePrompts.ts` | React Query hooks for prompt CRUD, lifecycle actions, comparison |
| `analytics/frontend/src/types/prompts.ts` | TypeScript types for prompt versions, comparison data |
| `analytics/frontend/src/pages/PromptManagementPage.tsx` | Main page — tree sidebar, editor, variable highlighting, comparison |

### Modified Files

| File | Change |
|------|--------|
| `analytics/backend/prisma/schema.prisma` | Add `prompt_versions` and `prompt_test_sessions` models |
| `analytics/backend/src/index.ts` | Register `promptsRouter` at `/api/prompts` |
| `app/models/db.py` | Add `PromptVersion` and `PromptTestSession` SQLAlchemy models + `init_db` fix |
| `app/schemas/api.py` | Add `is_test: bool = False` to `ChatRequest` |
| `app/services/rag_chatbot/state.py` | Add `is_test: bool` to `AgentState` |
| `app/services/rag_chatbot/agent.py` | Pass `is_test` into state, record test session |
| `app/services/rag_chatbot/nodes/planning.py` | Replace hardcoded system prompt with `resolve_prompt()` |
| `app/services/rag_chatbot/nodes/retrieval_and_answer.py` | Replace hardcoded capability prompt with `resolve_prompt()` |
| `analytics/frontend/src/App.tsx` | Add `/prompt-management` route |
| `analytics/frontend/src/components/Layout.tsx` | Add "Prompt Management" nav item between Knowledge Base and Test Agent |
| `analytics/frontend/src/pages/TestAgentPage.tsx` | Add `is_test: true` to chat request payload |

---

## Task 1: Database Schema — Prisma Migration

**Files:**
- Modify: `analytics/backend/prisma/schema.prisma`

- [ ] **Step 1: Add prompt models to Prisma schema**

Add at the end of `schema.prisma`:

```prisma
model prompt_versions {
  id           Int       @id @default(autoincrement())
  prompt_type  String
  version      Int
  name         String
  content      String
  status       String    @default("draft")
  created_at   DateTime  @default(now())
  updated_at   DateTime  @default(now()) @updatedAt
  published_at DateTime?

  prompt_test_sessions prompt_test_sessions[]

  @@unique([prompt_type, version])
}

model prompt_test_sessions {
  id                Int      @id @default(autoincrement())
  session_id        String
  prompt_type       String
  prompt_version_id Int
  created_at        DateTime @default(now())

  prompt_version prompt_versions @relation(fields: [prompt_version_id], references: [id])
}
```

- [ ] **Step 2: Generate and apply Prisma migration**

Run from `analytics/backend/`:
```bash
npx prisma migrate dev --name add_prompt_management
```
Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify generated Prisma client**

Run:
```bash
npx prisma generate
```
Expected: Prisma Client generated successfully.

- [ ] **Step 4: Commit**

```bash
git add analytics/backend/prisma/
git commit -m "feat: add prompt_versions and prompt_test_sessions tables"
```

---

## Task 2: SQLAlchemy Models for Python Agent

**Files:**
- Modify: `app/models/db.py`

- [ ] **Step 1: Add PromptVersion and PromptTestSession models**

Add after the `AgentEvent` class (before `_fix_auto_increment`):

```python
class PromptVersion(Base):
    """Stores versioned prompt templates managed through the analytics UI."""

    __tablename__ = "prompt_versions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    prompt_type = Column(String, nullable=False, index=True)
    version = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="draft")
    created_at = Column(DateTime, default=lambda: datetime.now(), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(), nullable=False)
    published_at = Column(DateTime, nullable=True)


class PromptTestSession(Base):
    """Tracks which prompt version was used in each Test Agent session."""

    __tablename__ = "prompt_test_sessions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    session_id = Column(String, nullable=False, index=True)
    prompt_type = Column(String, nullable=False)
    prompt_version_id = Column(
        Integer,
        ForeignKey("prompt_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(DateTime, default=lambda: datetime.now(), nullable=False)
```

- [ ] **Step 2: Add auto-increment fix calls in `init_db()`**

Add to the `init_db()` function:

```python
_fix_auto_increment("prompt_versions")
_fix_auto_increment("prompt_test_sessions")
```

- [ ] **Step 3: Commit**

```bash
git add app/models/db.py
git commit -m "feat: add PromptVersion and PromptTestSession SQLAlchemy models"
```

---

## Task 3: Backend Prompt Queries

**Files:**
- Create: `analytics/backend/src/db/promptQueries.ts`

- [ ] **Step 1: Create the prompt queries file**

```typescript
import { prisma } from './client';

// ---------- Types ----------

export interface PromptVersionRow {
  id: number;
  prompt_type: string;
  version: number;
  name: string;
  content: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

export interface CreatePromptInput {
  prompt_type: string;
  name: string;
  content: string;
}

export interface UpdatePromptInput {
  name?: string;
  content?: string;
}

export interface ComparisonMetrics {
  prompt_version_id: number;
  version_name: string;
  status: string;
  total_sessions: number;
  total_questions: number;
  idk_count: number;
  idk_rate: number;
  escalation_count: number;
  escalation_rate: number;
  avg_duration: number;
  avg_questions_per_session: number;
  avg_tokens: number;
}

// ---------- CRUD ----------

export async function getAllPromptVersions(promptType?: string): Promise<PromptVersionRow[]> {
  const where = promptType ? { prompt_type: promptType } : {};
  return prisma.prompt_versions.findMany({
    where,
    orderBy: [{ updated_at: 'desc' }],
  });
}

export async function getPromptVersionById(id: number): Promise<PromptVersionRow | null> {
  return prisma.prompt_versions.findUnique({ where: { id } });
}

export async function createPromptVersion(data: CreatePromptInput): Promise<PromptVersionRow> {
  // Get the next version number for this prompt_type
  const maxVersion = await prisma.prompt_versions.aggregate({
    where: { prompt_type: data.prompt_type },
    _max: { version: true },
  });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  return prisma.prompt_versions.create({
    data: {
      prompt_type: data.prompt_type,
      version: nextVersion,
      name: data.name,
      content: data.content,
      status: 'draft',
    },
  });
}

export async function updatePromptVersion(
  id: number,
  data: UpdatePromptInput,
): Promise<PromptVersionRow> {
  return prisma.prompt_versions.update({
    where: { id },
    data: {
      ...data,
      updated_at: new Date(),
    },
  });
}

// ---------- Lifecycle ----------

export async function publishPromptVersion(id: number): Promise<PromptVersionRow> {
  const version = await prisma.prompt_versions.findUniqueOrThrow({ where: { id } });

  // Archive the currently published version of the same type
  await prisma.prompt_versions.updateMany({
    where: {
      prompt_type: version.prompt_type,
      status: 'published',
    },
    data: {
      status: 'archived',
      updated_at: new Date(),
    },
  });

  // Publish this version
  return prisma.prompt_versions.update({
    where: { id },
    data: {
      status: 'published',
      published_at: new Date(),
      updated_at: new Date(),
    },
  });
}

export async function setTestingPromptVersion(id: number): Promise<PromptVersionRow> {
  const version = await prisma.prompt_versions.findUniqueOrThrow({ where: { id } });

  // Remove testing status from any other version of the same type
  await prisma.prompt_versions.updateMany({
    where: {
      prompt_type: version.prompt_type,
      status: 'testing',
    },
    data: {
      status: 'draft',
      updated_at: new Date(),
    },
  });

  return prisma.prompt_versions.update({
    where: { id },
    data: {
      status: 'testing',
      updated_at: new Date(),
    },
  });
}

export async function stopTestingPromptVersion(id: number): Promise<PromptVersionRow> {
  return prisma.prompt_versions.update({
    where: { id },
    data: {
      status: 'draft',
      updated_at: new Date(),
    },
  });
}

// ---------- Comparison Metrics ----------

export async function getComparisonMetrics(
  versionIdA: number,
  versionIdB: number,
): Promise<ComparisonMetrics[]> {
  const results: ComparisonMetrics[] = [];

  for (const versionId of [versionIdA, versionIdB]) {
    const version = await prisma.prompt_versions.findUniqueOrThrow({
      where: { id: versionId },
    });

    // Get all session IDs tracked for this version
    const testSessions = await prisma.prompt_test_sessions.findMany({
      where: { prompt_version_id: versionId },
      select: { session_id: true },
    });
    const sessionIds = testSessions.map((s) => s.session_id);

    // For published versions, also get sessions NOT in prompt_test_sessions
    // (production sessions that used this version by default)
    let allSessionIds = sessionIds;
    if (version.status === 'published' && version.published_at) {
      const productionSessions = await prisma.customer_support_chatbot_ai.findMany({
        where: {
          date_asked: { gte: version.published_at },
          session_id: { notIn: await _getAllTestSessionIds() },
        },
        select: { session_id: true },
        distinct: ['session_id'],
      });
      allSessionIds = [
        ...new Set([...sessionIds, ...productionSessions.map((s) => s.session_id)]),
      ];
    }

    if (allSessionIds.length === 0) {
      results.push({
        prompt_version_id: versionId,
        version_name: version.name,
        status: version.status,
        total_sessions: 0,
        total_questions: 0,
        idk_count: 0,
        idk_rate: 0,
        escalation_count: 0,
        escalation_rate: 0,
        avg_duration: 0,
        avg_questions_per_session: 0,
        avg_tokens: 0,
      });
      continue;
    }

    const uniqueSessionIds = [...new Set(allSessionIds)];

    const questions = await prisma.customer_support_chatbot_ai.findMany({
      where: { session_id: { in: uniqueSessionIds } },
    });

    const totalSessions = uniqueSessionIds.length;
    const totalQuestions = questions.length;
    const idkCount = questions.filter(
      (q) => q.answer?.toLowerCase().includes('idk') || q.answer?.toLowerCase().includes("i don't know"),
    ).length;
    const avgDuration =
      questions.reduce((sum, q) => sum + (q.duration ?? 0), 0) / (totalQuestions || 1);
    const avgTokens =
      questions.reduce((sum, q) => sum + (q.tokens_sent ?? 0) + (q.tokens_received ?? 0), 0) /
      (totalQuestions || 1);

    const escalations = await prisma.support_requests.count({
      where: { session_id: { in: uniqueSessionIds } },
    });

    results.push({
      prompt_version_id: versionId,
      version_name: version.name,
      status: version.status,
      total_sessions: totalSessions,
      total_questions: totalQuestions,
      idk_count: idkCount,
      idk_rate: totalQuestions > 0 ? (idkCount / totalQuestions) * 100 : 0,
      escalation_count: escalations,
      escalation_rate: totalSessions > 0 ? (escalations / totalSessions) * 100 : 0,
      avg_duration: Math.round(avgDuration * 10) / 10,
      avg_questions_per_session: totalSessions > 0
        ? Math.round((totalQuestions / totalSessions) * 10) / 10
        : 0,
      avg_tokens: Math.round(avgTokens),
    });
  }

  return results;
}

async function _getAllTestSessionIds(): Promise<string[]> {
  const sessions = await prisma.prompt_test_sessions.findMany({
    select: { session_id: true },
    distinct: ['session_id'],
  });
  return sessions.map((s) => s.session_id);
}

// ---------- Seed ----------

export async function seedPromptVersions(
  prompts: { prompt_type: string; name: string; content: string }[],
): Promise<PromptVersionRow[]> {
  const created: PromptVersionRow[] = [];
  for (const p of prompts) {
    // Skip if a published version already exists
    const existing = await prisma.prompt_versions.findFirst({
      where: { prompt_type: p.prompt_type, status: 'published' },
    });
    if (existing) continue;

    const version = await prisma.prompt_versions.create({
      data: {
        prompt_type: p.prompt_type,
        version: 1,
        name: p.name,
        content: p.content,
        status: 'published',
        published_at: new Date(),
      },
    });
    created.push(version);
  }
  return created;
}
```

- [ ] **Step 2: Commit**

```bash
git add analytics/backend/src/db/promptQueries.ts
git commit -m "feat: add prompt management database queries"
```

---

## Task 4: Backend Prompt Service

**Files:**
- Create: `analytics/backend/src/services/promptService.ts`

- [ ] **Step 1: Create the prompt service**

```typescript
import {
  getAllPromptVersions,
  getPromptVersionById,
  createPromptVersion,
  updatePromptVersion,
  publishPromptVersion,
  setTestingPromptVersion,
  stopTestingPromptVersion,
  getComparisonMetrics,
  seedPromptVersions,
  CreatePromptInput,
  UpdatePromptInput,
  PromptVersionRow,
  ComparisonMetrics,
} from '../db/promptQueries';

export {
  CreatePromptInput,
  UpdatePromptInput,
  PromptVersionRow,
  ComparisonMetrics,
};

export const listPromptVersions = async (promptType?: string): Promise<PromptVersionRow[]> => {
  return getAllPromptVersions(promptType);
};

export const getPromptVersion = async (id: number): Promise<PromptVersionRow | null> => {
  return getPromptVersionById(id);
};

export const createPrompt = async (data: CreatePromptInput): Promise<PromptVersionRow> => {
  return createPromptVersion(data);
};

export const updatePrompt = async (
  id: number,
  data: UpdatePromptInput,
): Promise<PromptVersionRow> => {
  const version = await getPromptVersionById(id);
  if (!version) throw new Error('Prompt version not found');
  if (version.status !== 'draft' && version.status !== 'testing') {
    throw new Error('Only draft and testing versions can be edited');
  }
  return updatePromptVersion(id, data);
};

export const publishPrompt = async (id: number): Promise<PromptVersionRow> => {
  return publishPromptVersion(id);
};

export const setPromptTesting = async (id: number): Promise<PromptVersionRow> => {
  return setTestingPromptVersion(id);
};

export const stopPromptTesting = async (id: number): Promise<PromptVersionRow> => {
  const version = await getPromptVersionById(id);
  if (!version) throw new Error('Prompt version not found');
  if (version.status !== 'testing') {
    throw new Error('Only testing versions can be stopped');
  }
  return stopTestingPromptVersion(id);
};

export const comparePrompts = async (
  idA: number,
  idB: number,
): Promise<ComparisonMetrics[]> => {
  return getComparisonMetrics(idA, idB);
};

export const seedPrompts = async (
  prompts: { prompt_type: string; name: string; content: string }[],
): Promise<PromptVersionRow[]> => {
  return seedPromptVersions(prompts);
};
```

- [ ] **Step 2: Commit**

```bash
git add analytics/backend/src/services/promptService.ts
git commit -m "feat: add prompt management service layer"
```

---

## Task 5: Backend Prompt Routes

**Files:**
- Create: `analytics/backend/src/routes/prompts.ts`
- Modify: `analytics/backend/src/index.ts`

- [ ] **Step 1: Create the prompts router**

```typescript
import { Router } from 'express';
import { z } from 'zod';
import {
  listPromptVersions,
  getPromptVersion,
  createPrompt,
  updatePrompt,
  publishPrompt,
  setPromptTesting,
  stopPromptTesting,
  comparePrompts,
  seedPrompts,
} from '../services/promptService';

const createSchema = z.object({
  prompt_type: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
});

const querySchema = z.object({
  type: z.string().optional(),
});

const compareSchema = z.object({
  ids: z.string().min(1),
});

const seedSchema = z.object({
  prompts: z.array(
    z.object({
      prompt_type: z.string().min(1),
      name: z.string().min(1),
      content: z.string().min(1),
    }),
  ),
});

export const promptsRouter = Router();

// List all versions, optionally filtered by type
promptsRouter.get('/', async (req, res, next) => {
  try {
    const { type } = querySchema.parse(req.query);
    const versions = await listPromptVersions(type);
    res.json(versions);
  } catch (error) {
    next(error);
  }
});

// Compare two versions (MUST be before /:id to avoid matching "compare" as an id)
promptsRouter.get('/compare', async (req, res, next) => {
  try {
    const { ids } = compareSchema.parse(req.query);
    const [idA, idB] = ids.split(',').map((s) => parseInt(s.trim(), 10));
    if (isNaN(idA) || isNaN(idB)) {
      return res.status(400).json({ error: 'ids must be two comma-separated integers' });
    }
    const metrics = await comparePrompts(idA, idB);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

// Get a single version
promptsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await getPromptVersion(id);
    if (!version) return res.status(404).json({ error: 'Not found' });
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Create a new draft
promptsRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const version = await createPrompt(data);
    res.status(201).json(version);
  } catch (error) {
    next(error);
  }
});

// Update a draft or testing version
promptsRouter.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const data = updateSchema.parse(req.body);
    const version = await updatePrompt(id, data);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Publish a version
promptsRouter.post('/:id/publish', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await publishPrompt(id);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Set as testing
promptsRouter.post('/:id/test', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await setPromptTesting(id);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Stop testing
promptsRouter.post('/:id/stop-test', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await stopPromptTesting(id);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Seed initial prompts
promptsRouter.post('/seed', async (req, res, next) => {
  try {
    const { prompts } = seedSchema.parse(req.body);
    const created = await seedPrompts(prompts);
    res.json({ seeded: created.length, versions: created });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: Register the router in index.ts**

In `analytics/backend/src/index.ts`, add the import and route registration.

After the line `import { agentRouter } from './routes/agent';` add:
```typescript
import { promptsRouter } from './routes/prompts';
```

After the line `app.use('/api/agent', agentRouter);` add:
```typescript
app.use('/api/prompts', promptsRouter);
```

**Note:** The `/api/prompts/compare` GET route is placed BEFORE the `/:id` GET route in the code above — this prevents Express from matching "compare" as a numeric ID parameter.

- [ ] **Step 3: Commit**

```bash
git add analytics/backend/src/routes/prompts.ts analytics/backend/src/index.ts
git commit -m "feat: add prompt management API routes"
```

---

## Task 6: Python Prompt Resolver

**Files:**
- Create: `app/services/rag_chatbot/prompt_resolver.py`

- [ ] **Step 1: Create the prompt resolver with TTL cache**

```python
import logging
import time
from app.models.db import SessionLocal, PromptVersion

logger = logging.getLogger(__name__)

# In-memory cache: {(prompt_type, status): (content, timestamp)}
_cache: dict[tuple[str, str], tuple[str, float]] = {}
_CACHE_TTL_SECONDS = 60


def _get_from_cache(prompt_type: str, status: str) -> str | None:
    key = (prompt_type, status)
    if key in _cache:
        content, ts = _cache[key]
        if time.time() - ts < _CACHE_TTL_SECONDS:
            return content
        del _cache[key]
    return None


def _set_cache(prompt_type: str, status: str, content: str) -> None:
    _cache[(prompt_type, status)] = (content, time.time())


def resolve_prompt(prompt_type: str, is_test_session: bool = False) -> str | None:
    """Resolve prompt content from the database.

    Args:
        prompt_type: e.g. "system_prompt", "capability_explanation"
        is_test_session: if True, prefer the "testing" version

    Returns:
        Prompt content string, or None if no version exists (caller uses hardcoded default).
    """
    if is_test_session:
        # Try testing version first
        content = _resolve_by_status(prompt_type, "testing")
        if content is not None:
            return content

    # Fall back to published version
    return _resolve_by_status(prompt_type, "published")


def _resolve_by_status(prompt_type: str, status: str) -> str | None:
    cached = _get_from_cache(prompt_type, status)
    if cached is not None:
        return cached

    try:
        with SessionLocal() as session:
            row = (
                session.query(PromptVersion)
                .filter(
                    PromptVersion.prompt_type == prompt_type,
                    PromptVersion.status == status,
                )
                .first()
            )
            if row is None:
                return None
            _set_cache(prompt_type, status, row.content)
            return row.content
    except Exception:
        logger.exception("Failed to resolve prompt %s/%s from DB", prompt_type, status)
        return None


def get_active_prompt_version_id(prompt_type: str, is_test_session: bool = False) -> int | None:
    """Return the ID of the active prompt version (for recording in prompt_test_sessions)."""
    status = "testing" if is_test_session else "published"
    try:
        with SessionLocal() as session:
            row = (
                session.query(PromptVersion)
                .filter(
                    PromptVersion.prompt_type == prompt_type,
                    PromptVersion.status == status,
                )
                .first()
            )
            if row is None and is_test_session:
                row = (
                    session.query(PromptVersion)
                    .filter(
                        PromptVersion.prompt_type == prompt_type,
                        PromptVersion.status == "published",
                    )
                    .first()
                )
            return row.id if row else None
    except Exception:
        logger.exception("Failed to get prompt version ID for %s", prompt_type)
        return None


def invalidate_prompt_cache() -> None:
    """Clear the prompt cache (useful for testing)."""
    _cache.clear()
```

- [ ] **Step 2: Commit**

```bash
git add app/services/rag_chatbot/prompt_resolver.py
git commit -m "feat: add prompt resolver with TTL cache"
```

---

## Task 7: Python Agent Integration

**Files:**
- Modify: `app/schemas/api.py`
- Modify: `app/services/rag_chatbot/state.py`
- Modify: `app/services/rag_chatbot/nodes/planning.py`
- Modify: `app/services/rag_chatbot/nodes/retrieval_and_answer.py`
- Modify: `app/services/rag_chatbot/agent.py:114-252` (stream method — state init + is_test param)
- Modify: `app/api/v1/endpoints.py:379-383` (agent.stream call site)
- Modify: `app/api/v1/endpoints.py:399-429` (done event handler — test session recording)

- [ ] **Step 1: Add `is_test` to ChatRequest**

In `app/schemas/api.py`, add to the `ChatRequest` class after the `open_ticket` field:

```python
    is_test: bool = Field(
        default=False,
        description="Set to true when calling from Test Agent page to use testing prompt version",
    )
```

- [ ] **Step 2: Add `is_test` to AgentState**

In `app/services/rag_chatbot/state.py`, add to the `AgentState` TypedDict:

```python
    is_test: bool
```

- [ ] **Step 3: Update `planning.py` to use `resolve_prompt`**

In `app/services/rag_chatbot/nodes/planning.py`:

Add import at the top:
```python
from app.services.rag_chatbot.prompt_resolver import resolve_prompt
```

In the `think_node` function, find the line where the system prompt f-string starts (the `system_prompt = f"""You are a customer support assistant for ZebraCRM.` block around line 223). Replace the entire system prompt construction with:

```python
    is_test = state.get("is_test", False)
    db_prompt = resolve_prompt("system_prompt", is_test_session=is_test)
    if db_prompt is not None:
        # Inject dynamic variables into the DB-stored template
        system_prompt = db_prompt.format(
            question_titles_text=question_titles_text,
            kb_context=_build_kb_context_text(bm25_raw_contexts),
            previous_queries=_build_prev_queries_text(bm25_queries),
            tool_usage_counts=f"bm25_calls={tool_counts.get('bm25', 0)} (unique_contexts={len(bm25_raw_contexts)}/25), mcq={tool_counts.get('mcq', 0)}/1, final_answer={tool_counts.get('final_answer', 0)}/1, capability_explanation={tool_counts.get('capability_explanation', 0)}/1",
            tool_limits="bm25_tool: maximum 25 unique contexts. mcq_tool: maximum 1 time. final_answer_tool: maximum 1 time. capability_explanation_tool: maximum 1 time. build_ticket_tool: ALWAYS available, maximum 1 time per user input.",
        )
    else:
        # Fallback: use the original hardcoded prompt
        system_prompt = f"""You are a customer support assistant for ZebraCRM.
...existing hardcoded prompt stays as fallback..."""
```

**Important:** Keep the existing hardcoded prompt as the `else` fallback. The `format()` call uses `{variable_name}` syntax which matches Python's string formatting — the DB-stored prompt template will use `{question_titles_text}` etc.

- [ ] **Step 4: Update `retrieval_and_answer.py` to use `resolve_prompt`**

In `app/services/rag_chatbot/nodes/retrieval_and_answer.py`:

Add import at the top:
```python
from app.services.rag_chatbot.prompt_resolver import resolve_prompt
```

In the `capability_explanation_node` function, find the prompt construction (around line 136). Replace with:

```python
    is_test = state.get("is_test", False)
    db_prompt = resolve_prompt("capability_explanation", is_test_session=is_test)
    if db_prompt is not None:
        prompt = db_prompt.format(conversation_text=conversation_text)
    else:
        # Fallback: use the original hardcoded prompt
        prompt = f"""Based on the conversation below, generate a capability explanation message...
...existing hardcoded prompt stays as fallback..."""
```

- [ ] **Step 5: Add `is_test` parameter to `Agent.stream()` method**

In `app/services/rag_chatbot/agent.py`, update the `stream` method signature at line 114:

```python
    async def stream(
        self, message: str, history: list[BaseMessage] = None, thread_id: str = None,
        is_test: bool = False,
    ) -> AsyncIterator[tuple[str, str]]:
```

Then add `"is_test": is_test` to ALL `run_input` dicts where state is initialized. There are two locations:

**Location 1** — new run after build_ticket/final_answer (line 227-231):
```python
                        run_input = {
                            "history": history,
                            "tool_counts": {"bm25": 0, "mcq": 0, "final_answer": 0, "capability_explanation": 0},
                            "bm25_queries": [],
                            "is_test": is_test,
                        }
```

**Location 2** — fresh new run (line 248-251):
```python
            run_input = {
                "history": history,
                "tool_counts": {"bm25": 0, "mcq": 0, "final_answer": 0, "capability_explanation": 0},
                "bm25_queries": [],
                "is_test": is_test,
            }
```

- [ ] **Step 6: Pass `is_test` from API endpoint to agent.stream()**

In `app/api/v1/endpoints.py`, find the `agent.stream()` call at line 379-382:

```python
            async for event_type, data in agent.stream(
                req.message,
                history=history_messages,
                thread_id=req.session_id,
            ):
```

Add the `is_test` parameter:

```python
            async for event_type, data in agent.stream(
                req.message,
                history=history_messages,
                thread_id=req.session_id,
                is_test=req.is_test,
            ):
```

- [ ] **Step 7: Add test session recording in the `done` event handler**

In `app/api/v1/endpoints.py`, find the `done` event handler (line 399-429). After `db.commit()` at line 429, add test session recording:

```python
                    # Record test session prompt assignments
                    if req.is_test:
                        from app.services.rag_chatbot.prompt_resolver import get_active_prompt_version_id
                        from app.models.db import PromptTestSession
                        for pt in ["system_prompt", "capability_explanation"]:
                            vid = get_active_prompt_version_id(pt, is_test_session=True)
                            if vid is not None:
                                db.add(PromptTestSession(
                                    session_id=req.session_id,
                                    prompt_type=pt,
                                    prompt_version_id=vid,
                                ))
                        db.commit()
```

- [ ] **Step 8: Commit**

```bash
git add app/schemas/api.py app/services/rag_chatbot/state.py \
  app/services/rag_chatbot/nodes/planning.py \
  app/services/rag_chatbot/nodes/retrieval_and_answer.py \
  app/services/rag_chatbot/agent.py \
  app/api/v1/endpoints.py
git commit -m "feat: integrate prompt resolver into agent pipeline"
```

---

## Task 8: Frontend — Test Agent Page Update

**Files:**
- Modify: `analytics/frontend/src/pages/TestAgentPage.tsx`

- [ ] **Step 1: Add `is_test: true` to all chat payloads**

In `TestAgentPage.tsx`, find all four `JSON.stringify` calls that build the chat payload:

1. **Main chat send** (~line 101): Add `is_test: true`
```typescript
body: JSON.stringify({
  message: userMessage.content,
  session_id: sessionId,
  is_test: true,
}),
```

2. **MCQ answer submit** (~line 303): Add `is_test: true`
```typescript
body: JSON.stringify({
  message: answer,
  session_id: sessionId,
  is_test: true,
}),
```

3. **Ticket open** (~line 498): Add `is_test: true`
```typescript
body: JSON.stringify({
  message: '',
  session_id: sessionId,
  open_ticket: 1,
  is_test: true,
}),
```

4. **Retry/resend** (~line 579): Add `is_test: true`
```typescript
body: JSON.stringify({
  message: userMessage.content,
  session_id: sessionId,
  is_test: true,
}),
```

- [ ] **Step 2: Commit**

```bash
git add analytics/frontend/src/pages/TestAgentPage.tsx
git commit -m "feat: add is_test flag to Test Agent chat requests"
```

---

## Task 9: Frontend — Types and Hooks

**Files:**
- Create: `analytics/frontend/src/types/prompts.ts`
- Create: `analytics/frontend/src/hooks/usePrompts.ts`

- [ ] **Step 1: Create types**

```typescript
export interface PromptVersion {
  id: number;
  prompt_type: string;
  version: number;
  name: string;
  content: string;
  status: 'draft' | 'testing' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface ComparisonMetrics {
  prompt_version_id: number;
  version_name: string;
  status: string;
  total_sessions: number;
  total_questions: number;
  idk_count: number;
  idk_rate: number;
  escalation_count: number;
  escalation_rate: number;
  avg_duration: number;
  avg_questions_per_session: number;
  avg_tokens: number;
}

// Known template variables per prompt type
export const PROMPT_VARIABLES: Record<string, { name: string; description: string }[]> = {
  system_prompt: [
    { name: 'question_titles_text', description: 'List of knowledge base question titles' },
    { name: 'kb_context', description: 'BM25 retrieval results from knowledge base' },
    { name: 'previous_queries', description: 'Search queries made earlier in the session' },
    { name: 'tool_usage_counts', description: 'Current count of each tool used' },
    { name: 'tool_limits', description: 'Maximum allowed uses per tool' },
  ],
  capability_explanation: [
    { name: 'conversation_text', description: 'Formatted conversation history' },
  ],
};
```

- [ ] **Step 2: Create hooks**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PromptVersion, ComparisonMetrics } from '../types/prompts';

export const usePromptVersions = (promptType?: string) =>
  useQuery<PromptVersion[]>({
    queryKey: ['prompts', promptType],
    queryFn: async () => {
      const params = promptType ? { type: promptType } : {};
      const response = await api.get('/prompts', { params });
      return response.data;
    },
    staleTime: 30_000,
  });

export const usePromptVersion = (id: number | null) =>
  useQuery<PromptVersion>({
    queryKey: ['prompts', 'detail', id],
    queryFn: async () => {
      const response = await api.get(`/prompts/${id}`);
      return response.data;
    },
    enabled: id !== null,
    staleTime: 30_000,
  });

export const useCreatePrompt = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, { prompt_type: string; name: string; content: string }>({
    mutationFn: async (data) => {
      const response = await api.post('/prompts', data);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useUpdatePrompt = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, { id: number; data: { name?: string; content?: string } }>({
    mutationFn: async ({ id, data }) => {
      const response = await api.put(`/prompts/${id}`, data);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const usePublishPrompt = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, number>({
    mutationFn: async (id) => {
      const response = await api.post(`/prompts/${id}/publish`);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useSetPromptTesting = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, number>({
    mutationFn: async (id) => {
      const response = await api.post(`/prompts/${id}/test`);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useStopPromptTesting = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, number>({
    mutationFn: async (id) => {
      const response = await api.post(`/prompts/${id}/stop-test`);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useComparePrompts = (idA: number | null, idB: number | null) =>
  useQuery<ComparisonMetrics[]>({
    queryKey: ['prompts', 'compare', idA, idB],
    queryFn: async () => {
      const response = await api.get('/prompts/compare', { params: { ids: `${idA},${idB}` } });
      return response.data;
    },
    enabled: idA !== null && idB !== null,
    staleTime: 30_000,
  });

export const useSeedPrompts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prompts: { prompt_type: string; name: string; content: string }[]) => {
      const response = await api.post('/prompts/seed', { prompts });
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};
```

- [ ] **Step 3: Commit**

```bash
git add analytics/frontend/src/types/prompts.ts analytics/frontend/src/hooks/usePrompts.ts
git commit -m "feat: add prompt management types and React Query hooks"
```

---

## Task 10: Frontend — Prompt Management Page

**Files:**
- Create: `analytics/frontend/src/pages/PromptManagementPage.tsx`

This is the largest task. The page has these sections:
1. Tree sidebar with prompt types and versions
2. Detail panel with editor (single version view)
3. Comparison view (two versions selected)
4. Variable highlighting

- [ ] **Step 1: Create the PromptManagementPage component**

Create `analytics/frontend/src/pages/PromptManagementPage.tsx` with the full implementation.

The component should implement:

**State:**
- `selectedVersionId: number | null` — currently selected version in tree
- `compareIds: [number | null, number | null]` — two version IDs selected for comparison
- `editName: string` — draft name being edited
- `editContent: string` — draft content being edited
- `hasUnsavedChanges: boolean` — tracks unsaved edits

**Tree sidebar:**
- Group versions by `prompt_type`
- Within each group, sort: `published` first, `testing` second, then by `updated_at` desc
- Each item shows: name, status badge (colored), relative timestamp
- Click selects for detail view
- **+/- comparison buttons:** On hover, show `+` if fewer than 2 selected for comparison. After clicking `+`, it stays visible. On hover of a selected item, show `-` to deselect.
- "New Version" button at top, opens a form to select prompt_type and set initial name

**Detail panel (single version):**
- Header: breadcrumb (type / name), editable name input (for draft/testing), status badge
- Action buttons based on status (per spec)
- Editor: dark-themed `<textarea>` with monospace font
  - Read-only for published/archived
  - Editable for draft/testing
  - Known template variables highlighted with colored inline markers using a preview overlay or rendered view
- Variable list below editor (see variable highlighting section)
- Metrics bar at bottom (query using the version's sessions)

**Variable highlighting:**
- Parse `content` for `{variable_name}` patterns
- Match against `PROMPT_VARIABLES[prompt_type]`
- Count occurrences of each known variable
- Color coding: grey chip (0 uses), blue chip (1 use), yellow chip (>1 use)
- Each chip shows a count badge
- In the editor preview, highlight known variables with matching colors

**Comparison view:**
- Activated when `compareIds` has two non-null values
- Side-by-side text panels with diff highlighting
- Metrics comparison table below
- "Exit Compare" button

**Implementation notes:**
- Use `usePromptVersions()` to load all versions
- Use mutations for lifecycle actions with optimistic updates
- Variable detection: `content.match(/\{(\w+)\}/g)` then filter against known variables
- For diff highlighting: split both texts by lines, compare, mark added (green bg) / removed (red bg)
- Confirm dialogs before Publish and Stop Test actions

This is a large component (~600-800 lines). Consider splitting into sub-components if it grows beyond readability:
- `PromptTree.tsx` — tree sidebar
- `PromptEditor.tsx` — editor with variable highlighting
- `PromptCompare.tsx` — comparison view

But start as a single file and split only if needed.

- [ ] **Step 2: Verify the page renders correctly**

Run the frontend dev server and navigate to `/prompt-management`. Verify:
- Tree sidebar shows prompt types (may be empty if not seeded yet)
- "New Version" button works
- No console errors

- [ ] **Step 3: Commit**

```bash
git add analytics/frontend/src/pages/PromptManagementPage.tsx
git commit -m "feat: add Prompt Management page with tree, editor, and comparison"
```

---

## Task 11: Frontend — Routing and Navigation

**Files:**
- Modify: `analytics/frontend/src/App.tsx`
- Modify: `analytics/frontend/src/components/Layout.tsx`

- [ ] **Step 1: Add route to App.tsx**

Add import:
```typescript
import { PromptManagementPage } from './pages/PromptManagementPage';
```

Add route after the knowledge-base route and before test-agent:
```tsx
<Route path="/prompt-management" element={<PromptManagementPage />} />
```

- [ ] **Step 2: Add nav item to Layout.tsx**

In the `navItems` array, add between Knowledge Base and Test Agent:
```typescript
{ to: '/prompt-management', label: 'Prompt Management' },
```

The array becomes:
```typescript
const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/chat-history', label: 'Chat History' },
  { to: '/user-usage', label: 'User Usage' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/comments', label: 'Comments' },
  { to: '/knowledge-base', label: 'Knowledge Base' },
  { to: '/prompt-management', label: 'Prompt Management' },
  { to: '/test-agent', label: 'Test Agent' },
];
```

- [ ] **Step 3: Commit**

```bash
git add analytics/frontend/src/App.tsx analytics/frontend/src/components/Layout.tsx
git commit -m "feat: add Prompt Management to routing and sidebar navigation"
```

---

## Task 12: Seed Initial Prompts

**Files:** None (API call only)

- [ ] **Step 1: Extract current hardcoded prompts**

Read the current system prompt from `planning.py` (lines 223-270) and the capability explanation prompt from `retrieval_and_answer.py` (lines 136-151). Convert the f-string variables to `{variable_name}` template syntax.

For the system prompt, the template should use these placeholders:
- `{question_titles_text}`
- `{kb_context}` (replacing the `_build_kb_context_text()` call)
- `{previous_queries}` (replacing the `_build_prev_queries_text()` call)
- `{tool_usage_counts}` (replacing the inline f-string for tool counts)
- `{tool_limits}` (replacing the hardcoded tool limits text)

For capability explanation:
- `{conversation_text}`

- [ ] **Step 2: Call the seed endpoint**

```bash
curl -X POST http://localhost:4001/api/prompts/seed \
  -H 'Content-Type: application/json' \
  -d '{
    "prompts": [
      {
        "prompt_type": "system_prompt",
        "name": "v1 - Initial",
        "content": "...extracted system prompt template..."
      },
      {
        "prompt_type": "capability_explanation",
        "name": "v1 - Initial",
        "content": "...extracted capability explanation template..."
      }
    ]
  }'
```

Expected: `{ "seeded": 2, "versions": [...] }`

- [ ] **Step 3: Verify in the UI**

Navigate to `/prompt-management`. Both prompt types should appear in the tree with `published` status.

- [ ] **Step 4: Commit** (if any adjustments were needed)

---

## Task 13: End-to-End Verification

- [ ] **Step 1: Test version lifecycle in UI**

1. Navigate to Prompt Management page
2. Click "New Version" for System Prompt → creates a draft
3. Edit the content, click Save
4. Click "Set as Testing" → status changes to testing
5. Verify the published version is still at top of list

- [ ] **Step 2: Test via Test Agent page**

1. Navigate to Test Agent page
2. Send a message
3. Verify the agent uses the testing prompt version (check behavior matches the testing version's instructions)

- [ ] **Step 3: Test comparison**

1. Go back to Prompt Management
2. Click `+` on the published version, then `+` on the testing version
3. Verify diff view shows with text differences highlighted
4. Verify metrics table appears (may have 0 sessions for testing initially)

- [ ] **Step 4: Test publish flow**

1. Click "Publish" on the testing version
2. Confirm the dialog
3. Verify: testing version becomes published, old published becomes archived
4. Test Agent page should now use the new published prompt

- [ ] **Step 5: Test stop-test flow**

1. Create a new draft, set as testing
2. Click "Stop Test"
3. Verify: version returns to draft, Test Agent uses published version
