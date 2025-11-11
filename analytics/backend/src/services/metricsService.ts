import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';

export interface MetricsFilters {
  from?: Date;
  to?: Date;
  theme?: string;
  userId?: string;
}

const createChatbotWhere = (
  filters: MetricsFilters,
): Prisma.customer_support_chatbot_aiWhereInput => {
  const where: Prisma.customer_support_chatbot_aiWhereInput = {};

  if (filters.theme) {
    where.theme = filters.theme;
  }

  if (filters.userId) {
    where.user_id = filters.userId;
  }

  if (filters.from || filters.to) {
    where.date_asked = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  return where;
};

const createSupportWhere = (
  filters: MetricsFilters,
): Prisma.support_requestsWhereInput => {
  const where: Prisma.support_requestsWhereInput = {};

  if (filters.theme) {
    where.theme = filters.theme;
  }

  if (filters.userId) {
    where.user_id = filters.userId;
  }

  if (filters.from || filters.to) {
    where.date_added = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  return where;
};

export const getSummaryMetrics = async (filters: MetricsFilters = {}) => {
  const baseWhere = createChatbotWhere(filters);
  const idkWhere: Prisma.customer_support_chatbot_aiWhereInput = {
    ...baseWhere,
    answer: {
      equals: 'IDK',
      mode: 'insensitive',
    },
  };

  const tokensWhere: Prisma.customer_support_chatbot_aiWhereInput = {
    ...baseWhere,
    OR: [
      { tokens_sent: { not: null } },
      { tokens_received: { not: null } },
    ],
  };

  const [
    totalQuestions,
    sessionGroups,
    userGroups,
    totalIdk,
    durationAggregate,
    tokenAggregate,
  ] = await Promise.all([
    prisma.customer_support_chatbot_ai.count({ where: baseWhere }),
    prisma.customer_support_chatbot_ai.groupBy({
      where: baseWhere,
      by: ['session_id'],
      _count: { session_id: true },
    }),
    prisma.customer_support_chatbot_ai.groupBy({
      where: {
        ...baseWhere,
        user_id: { not: null },
      },
      by: ['user_id'],
      _count: { user_id: true },
    }),
    prisma.customer_support_chatbot_ai.count({ where: idkWhere }),
    prisma.customer_support_chatbot_ai.aggregate({
      where: {
        ...baseWhere,
        duration: { not: null },
      },
      _avg: { duration: true },
    }),
    prisma.customer_support_chatbot_ai.aggregate({
      where: tokensWhere,
      _avg: {
        tokens_sent: true,
        tokens_received: true,
      },
      _sum: {
        tokens_sent: true,
        tokens_received: true,
      },
      _count: { _all: true },
    }),
  ]);

  const totalSessions = sessionGroups.length;
  const uniqueUsers = userGroups.length;
  const averageDuration = durationAggregate._avg.duration ?? 0;
  const averageTokensSent = tokenAggregate._avg.tokens_sent ?? 0;
  const averageTokensReceived = tokenAggregate._avg.tokens_received ?? 0;
  const averageTotalTokens = tokenAggregate._count._all
    ? ((tokenAggregate._sum.tokens_sent ?? 0) + (tokenAggregate._sum.tokens_received ?? 0)) /
      tokenAggregate._count._all
    : 0;

  const supportWhere = createSupportWhere(filters);
  const supportSessionGroups = await prisma.support_requests.groupBy({
    where: supportWhere,
    by: ['session_id'],
    _count: { session_id: true },
  });

  const sessionsWithSupportRequest = supportSessionGroups.length;
  const percentSessionsWithSupportRequest = totalSessions
    ? (sessionsWithSupportRequest / totalSessions) * 100
    : 0;

  const percentIdkMessages = totalQuestions ? (totalIdk / totalQuestions) * 100 : 0;

  return {
    totalQuestions,
    totalSessions,
    uniqueUsers,
    totalIdk,
    averageDuration,
    averageTokensSent,
    averageTokensReceived,
    averageTotalTokens,
    percentSessionsWithSupportRequest,
    percentIdkMessages,
  };
};

export const getIdkSessions = async (filters: MetricsFilters = {}) => {
  const baseWhere = createChatbotWhere(filters);
  const idkWhere: Prisma.customer_support_chatbot_aiWhereInput = {
    ...baseWhere,
    answer: {
      equals: 'IDK',
      mode: 'insensitive',
    },
  };

  const sessionGroups = await prisma.customer_support_chatbot_ai.groupBy({
    where: idkWhere,
    by: ['session_id'],
    _max: { id: true },
    _count: { _all: true },
    orderBy: {
      _max: {
        id: 'desc',
      },
    },
    take: 5,
  });

  const sessions = await Promise.all(
    sessionGroups.map(async (group) => {
      const messages = await prisma.customer_support_chatbot_ai.findMany({
        where: {
          session_id: group.session_id,
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          question: true,
          answer: true,
          date_asked: true,
        },
      });

      return {
        sessionId: group.session_id,
        idkCount: group._count._all,
        latestId: group._max.id ?? 0,
        messages: messages.map((message) => ({
          id: message.id,
          question: message.question,
          answer: message.answer,
          dateAsked: message.date_asked?.toISOString() ?? null,
        })),
      };
    }),
  );

  return sessions;
};
