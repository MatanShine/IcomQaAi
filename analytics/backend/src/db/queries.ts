import { prisma } from './client';

export interface SummaryFilters {
  from?: Date;
  to?: Date;
  theme?: string;
  userId?: string;
}

const buildDateFilter = (from?: Date, to?: Date) => {
  if (!from && !to) {
    return undefined;
  }

  return {
    gte: from,
    lte: to,
  };
};

const buildChatbotWhere = ({ from, to, theme, userId }: SummaryFilters) => ({
  ...(theme ? { theme } : {}),
  ...(userId ? { user_id: userId } : {}),
  ...(from || to
    ? {
        date_asked: buildDateFilter(from, to),
      }
    : {}),
});

const buildSupportRequestWhere = ({ from, to, theme, userId }: SummaryFilters) => ({
  ...(theme ? { theme } : {}),
  ...(userId ? { user_id: userId } : {}),
  ...(from || to
    ? {
        date_added: buildDateFilter(from, to),
      }
    : {}),
});

export const fetchSummaryMetrics = async (filters: SummaryFilters) => {
  const chatbotWhere = buildChatbotWhere(filters);
  const supportWhere = buildSupportRequestWhere(filters);

  const [
    totalQuestions,
    sessionGroups,
    uniqueUsers,
    totalIdk,
    averages,
    supportRequestSessions,
  ] = await Promise.all([
    prisma.customer_support_chatbot_ai.count({ where: chatbotWhere }),
    prisma.customer_support_chatbot_ai.groupBy({
      by: ['session_id'],
      where: chatbotWhere,
      _count: { session_id: true },
    }),
    prisma.customer_support_chatbot_ai.groupBy({
      by: ['user_id'],
      where: chatbotWhere,
      _count: { user_id: true },
    }),
    prisma.customer_support_chatbot_ai.count({
      where: {
        ...chatbotWhere,
        answer: {
          contains: 'idk',
          mode: 'insensitive',
        },
      },
    }),
    prisma.customer_support_chatbot_ai.aggregate({
      where: chatbotWhere,
      _avg: {
        duration: true,
        tokens_sent: true,
        tokens_received: true,
      },
    }),
    prisma.support_requests.groupBy({
      by: ['session_id'],
      where: supportWhere,
      _count: { session_id: true },
    }),
  ]);

  const totalSessions = sessionGroups.length;
  const averageDuration = averages._avg.duration ?? 0;
  const averageSentTokens = averages._avg.tokens_sent ?? 0;
  const averageReceivedTokens = averages._avg.tokens_received ?? 0;
  const averageTotalTokens = averageSentTokens + averageReceivedTokens;
  const supportRequestSessionCount = supportRequestSessions.length;

  const percentSupportRequests =
    totalSessions > 0 ? (supportRequestSessionCount / totalSessions) * 100 : 0;
  const percentIdkMessages = totalQuestions > 0 ? (totalIdk / totalQuestions) * 100 : 0;

  return {
    totalQuestions,
    totalSessions,
    uniqueUsers: uniqueUsers.length,
    totalIdk,
    averageDuration,
    averageSentTokens,
    averageReceivedTokens,
    averageTotalTokens,
    supportRequestSessionPercentage: percentSupportRequests,
    idkMessagePercentage: percentIdkMessages,
  };
};

export const fetchRecentSessions = async (filters: SummaryFilters) => {
  const chatbotWhere = buildChatbotWhere(filters);

  const recentSessionGroups = await prisma.customer_support_chatbot_ai.groupBy({
    by: ['session_id'],
    where: chatbotWhere,
    _max: { id: true },
    orderBy: {
      _max: { id: 'desc' },
    },
    take: 5,
  });

  const sessionIds = recentSessionGroups
    .map((group) => group.session_id)
    .filter((sessionId): sessionId is string => Boolean(sessionId));

  if (sessionIds.length === 0) {
    return [];
  }

  const interactions = await prisma.customer_support_chatbot_ai.findMany({
    where: {
      ...chatbotWhere,
      session_id: {
        in: sessionIds,
      },
    },
    orderBy: {
      id: 'asc',
    },
  });

  const sessionsMap = new Map<
    string,
    {
      sessionId: string;
      interactions: { id: number; question: string; answer: string }[];
    }
  >();

  for (const record of interactions) {
    const sessionId = record.session_id;
    if (!sessionId) {
      continue;
    }

    if (!sessionsMap.has(sessionId)) {
      sessionsMap.set(sessionId, { sessionId, interactions: [] });
    }

    sessionsMap.get(sessionId)!.interactions.push({
      id: record.id,
      question: record.question,
      answer: record.answer,
    });
  }

  return sessionIds.map((sessionId) => sessionsMap.get(sessionId) ?? { sessionId, interactions: [] });
};

export const fetchSupportRequests = async (filters: SummaryFilters) => {
  const where = buildSupportRequestWhere(filters);

  const requests = await prisma.support_requests.findMany({
    where,
    orderBy: {
      date_added: 'desc',
    },
  });

  return requests;
};