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

export const fetchSummaryMetrics = async ({ from, to, theme, userId }: SummaryFilters) => {
  const where = {
    ...(theme ? { theme } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(from || to
      ? {
          date_asked: buildDateFilter(from, to),
        }
      : {}),
  };

  const [totalQuestions, totalSessions, uniqueUsers, totalIdk] = await Promise.all([
    prisma.customer_support_chatbot_ai.count({ where }),
    prisma.customer_support_chatbot_ai.groupBy({
      by: ['session_id'],
      where,
      _count: { session_id: true },
    }),
    prisma.customer_support_chatbot_ai.groupBy({
      by: ['user_id'],
      where,
      _count: { user_id: true },
    }),
    prisma.customer_support_chatbot_ai.count({
      where: {
        ...where,
        answer: {
          contains: 'idk',
          mode: 'insensitive',
        },
      },
    }),
  ]);

  const averageDuration = await prisma.customer_support_chatbot_ai.aggregate({
    where,
    _avg: { duration: true, tokens_used: true },
  });

  return {
    totalQuestions,
    totalSessions: totalSessions.length,
    uniqueUsers: uniqueUsers.length,
    totalIdk,
    averageDuration: averageDuration._avg.duration ?? 0,
    averageTokens: averageDuration._avg.tokens_used ?? 0,
  };
};

export const fetchIdkSessions = async () => {
  const sessions = await prisma.customer_support_chatbot_ai.groupBy({
    by: ['session_id'],
    where: {
      answer: {
        contains: 'idk',
        mode: 'insensitive',
      },
    },
    _count: { session_id: true },
  });

  return sessions.map((session) => ({
    sessionId: session.session_id,
    idkCount: session._count.session_id,
  }));
};

export const fetchSupportRequests = async ({ from, to, theme, userId }: SummaryFilters) => {
  const where = {
    ...(theme ? { theme } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(from || to
      ? {
          date_added: buildDateFilter(from, to),
        }
      : {}),
  };

  const requests = await prisma.support_requests.findMany({
    where,
    orderBy: {
      date_added: 'desc',
    },
  });

  return requests;
};
