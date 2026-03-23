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

    const testSessions = await prisma.prompt_test_sessions.findMany({
      where: { prompt_version_id: versionId },
      select: { session_id: true },
    });
    const sessionIds = testSessions.map((s) => s.session_id);

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
