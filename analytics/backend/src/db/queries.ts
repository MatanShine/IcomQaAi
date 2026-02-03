import { prisma } from './client';

export interface SummaryFilters {
  from?: Date;
  to?: Date;
  theme?: string;
  userId?: string;
  timeRange?: string;
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
    idkSessions,
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
    prisma.customer_support_chatbot_ai.groupBy({
      by: ['session_id'],
      where: {
        ...chatbotWhere,
        answer: {
          contains: 'idk',
          mode: 'insensitive',
        },
      },
      _count: { session_id: true },
    }),
  ]);

  const totalSessions = sessionGroups.length;
  const averageDuration = averages._avg.duration ?? 0;
  const averageTotalTokens = (averages._avg.tokens_sent ?? 0) + (averages._avg.tokens_received ?? 0);
  const averageQuestionsPerSession = totalSessions > 0 ? totalQuestions / totalSessions : 0;
  const averageIdkPerSession = totalSessions > 0 ? totalIdk / totalSessions : 0;
  const supportRequestSessionCount = supportRequestSessions.length;
  const idkSessionCount = idkSessions.length;

  // Find sessions that have both IDK messages and support requests
  const supportRequestSessionIds = new Set(
    supportRequestSessions
      .map((s: { session_id: string | null }) => s.session_id)
      .filter((id: string | null): id is string => Boolean(id))
  );
  const idkSessionIds = new Set(
    idkSessions
      .map((s: { session_id: string | null }) => s.session_id)
      .filter((id: string | null): id is string => Boolean(id))
  );
  const idkAndSupportRequestSessionCount = Array.from(supportRequestSessionIds).filter((id) =>
    idkSessionIds.has(id)
  ).length;

  const percentSupportRequests =
    totalSessions > 0 ? (supportRequestSessionCount / totalSessions) * 100 : 0;
  const percentIdkMessages = totalQuestions > 0 ? (totalIdk / totalQuestions) * 100 : 0;
  const percentIdkSessions = totalSessions > 0 ? (idkSessionCount / totalSessions) * 100 : 0;
  const percentIdkAndSupportRequestSessions =
    totalSessions > 0 ? (idkAndSupportRequestSessionCount / totalSessions) * 100 : 0;

  return {
    totalQuestions,
    totalSessions,
    uniqueUsers: uniqueUsers.length,
    totalIdk,
    averageDuration,
    averageQuestionsPerSession,
    averageIdkPerSession,
    averageTotalTokens,
    supportRequestSessionPercentage: percentSupportRequests,
    idkMessagePercentage: percentIdkMessages,
    idkSessionPercentage: percentIdkSessions,
    idkAndSupportRequestSessionPercentage: percentIdkAndSupportRequestSessions,
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
    .map((group: { session_id: string }) => group.session_id)
    .filter((sessionId: string | undefined): sessionId is string => Boolean(sessionId));

  if (sessionIds.length === 0) {
    return [];
  }

  const [interactions, supportRequests] = await Promise.all([
    prisma.customer_support_chatbot_ai.findMany({
      where: {
        ...chatbotWhere,
        session_id: {
          in: sessionIds,
        },
      },
      orderBy: {
        id: 'asc',
      },
    }),
    prisma.support_requests.findMany({
      where: {
        session_id: {
          in: sessionIds,
        },
      },
      select: {
        session_id: true,
      },
    }),
  ]);

  const supportRequestSessionIds = new Set(
    supportRequests
      .map((sr: { session_id: string }) => sr.session_id)
      .filter((id: string | null): id is string => Boolean(id))
  );

  const sessionsMap = new Map<
    string,
    {
      sessionId: string;
      userId: string | null;
      theme: string | null;
      interactions: { id: number; question: string; answer: string }[];
      hasSupportRequest: boolean;
      lastQuestionTime: Date | null;
    }
  >();

  for (const record of interactions) {
    const sessionId = record.session_id;
    if (!sessionId) {
      continue;
    }

    if (!sessionsMap.has(sessionId)) {
      sessionsMap.set(sessionId, {
        sessionId,
        userId: record.user_id ?? null,
        theme: record.theme ?? null,
        interactions: [],
        hasSupportRequest: supportRequestSessionIds.has(sessionId),
        lastQuestionTime: record.date_asked ?? null,
      });
    }

    const session = sessionsMap.get(sessionId)!;
    session.interactions.push({
      id: record.id,
      question: record.question,
      answer: record.answer,
    });
    
    // Update lastQuestionTime if this interaction is more recent
    if (record.date_asked && (!session.lastQuestionTime || record.date_asked > session.lastQuestionTime)) {
      session.lastQuestionTime = record.date_asked;
    }
  }

  return sessionIds.map((sessionId: string) => sessionsMap.get(sessionId) ?? {
    sessionId,
    userId: null,
    theme: null,
    interactions: [],
    hasSupportRequest: supportRequestSessionIds.has(sessionId),
    lastQuestionTime: null,
  });
};

export const fetchAllSessions = async (filters: SummaryFilters) => {
  const chatbotWhere = buildChatbotWhere(filters);

  const recentSessionGroups = await prisma.customer_support_chatbot_ai.groupBy({
    by: ['session_id'],
    where: chatbotWhere,
    _max: { id: true },
    orderBy: {
      _max: { id: 'desc' },
    },
  });

  const sessionIds = recentSessionGroups
    .map((group: { session_id: string }) => group.session_id)
    .filter((sessionId: string | undefined): sessionId is string => Boolean(sessionId));

  if (sessionIds.length === 0) {
    return [];
  }

  const [interactions, supportRequests] = await Promise.all([
    prisma.customer_support_chatbot_ai.findMany({
      where: {
        ...chatbotWhere,
        session_id: {
          in: sessionIds,
        },
      },
      orderBy: {
        id: 'asc',
      },
    }),
    prisma.support_requests.findMany({
      where: {
        session_id: {
          in: sessionIds,
        },
      },
      select: {
        session_id: true,
      },
    }),
  ]);

  const supportRequestSessionIds = new Set(
    supportRequests
      .map((sr: { session_id: string }) => sr.session_id)
      .filter((id: string | null): id is string => Boolean(id))
  );

  const sessionsMap = new Map<
    string,
    {
      sessionId: string;
      userId: string | null;
      theme: string | null;
      interactions: { id: number; question: string; answer: string; context: string | null }[];
      hasSupportRequest: boolean;
      lastQuestionTime: Date | null;
    }
  >();

  for (const record of interactions) {
    const sessionId = record.session_id;
    if (!sessionId) {
      continue;
    }

    if (!sessionsMap.has(sessionId)) {
      sessionsMap.set(sessionId, {
        sessionId,
        userId: record.user_id ?? null,
        theme: record.theme ?? null,
        interactions: [],
        hasSupportRequest: supportRequestSessionIds.has(sessionId),
        lastQuestionTime: record.date_asked ?? null,
      });
    }

    const session = sessionsMap.get(sessionId)!;
    session.interactions.push({
      id: record.id,
      question: record.question,
      answer: record.answer,
      context: record.context ?? null,
    });
    
    // Update lastQuestionTime if this interaction is more recent
    if (record.date_asked && (!session.lastQuestionTime || record.date_asked > session.lastQuestionTime)) {
      session.lastQuestionTime = record.date_asked;
    }
  }

  return sessionIds.map((sessionId: string) => sessionsMap.get(sessionId) ?? {
    sessionId,
    userId: null,
    theme: null,
    interactions: [],
    hasSupportRequest: supportRequestSessionIds.has(sessionId),
    lastQuestionTime: null,
  });
};

export interface ThemeUsageStats {
  theme: string;
  questionCount: number;
  userCount: number;
  sessionCount: number;
  idkCount: number;
  supportRequestCount: number;
}

export const fetchThemeUsageStats = async (filters: SummaryFilters) => {
  const chatbotWhere = buildChatbotWhere(filters);
  const supportWhere = buildSupportRequestWhere(filters);

  // Get all themes with non-null values
  const themesWithQuestions = await prisma.customer_support_chatbot_ai.groupBy({
    by: ['theme'],
    where: {
      ...chatbotWhere,
      theme: { not: null },
    },
    _count: { theme: true },
  });

  // Get all unique themes
  const themes = themesWithQuestions
    .map((t: {theme: string}) => t.theme)
    .filter((theme: string | null): theme is string => theme !== null);

  if (themes.length === 0) {
    return [];
  }

  // For each theme, get all the statistics
  const themeStats = await Promise.all(
    themes.map(async (theme: string) => {
      const themeChatbotWhere = { ...chatbotWhere, theme };
      const themeSupportWhere = { ...supportWhere, theme };

      const [
        questionCount,
        uniqueUsers,
        sessions,
        idkCount,
        supportRequestCount,
      ] = await Promise.all([
        prisma.customer_support_chatbot_ai.count({ where: themeChatbotWhere }),
        prisma.customer_support_chatbot_ai.groupBy({
          by: ['user_id'],
          where: themeChatbotWhere,
        }),
        prisma.customer_support_chatbot_ai.groupBy({
          by: ['session_id'],
          where: themeChatbotWhere,
        }),
        prisma.customer_support_chatbot_ai.count({
          where: {
            ...themeChatbotWhere,
            answer: {
              contains: 'idk',
              mode: 'insensitive',
            },
          },
        }),
        prisma.support_requests.count({ where: themeSupportWhere }),
      ]);

      return {
        theme,
        questionCount,
        userCount: uniqueUsers.filter((u: { user_id: string | null }) => u.user_id !== null).length,
        sessionCount: sessions.filter((s: { session_id: string | null }) => s.session_id !== null).length,
        idkCount,
        supportRequestCount,
      };
    })
  );

  // Sort by question count descending
  return themeStats.sort((a, b) => b.questionCount - a.questionCount);
};

export interface UserThemeStats {
  userId: string;
  sessionCount: number;
  questionCount: number;
  idkCount: number;
  supportRequestCount: number;
}

export const fetchUsersByTheme = async (theme: string, filters: SummaryFilters): Promise<UserThemeStats[]> => {
  const themeChatbotWhere = { ...buildChatbotWhere(filters), theme };
  const themeSupportWhere = { ...buildSupportRequestWhere(filters), theme };

  // Get all unique users for this theme
  const userGroups = await prisma.customer_support_chatbot_ai.groupBy({
    by: ['user_id'],
    where: {
      ...themeChatbotWhere,
      user_id: { not: null },
    },
  });

  const userIds = userGroups
    .map((u: { user_id: string | null }) => u.user_id)
    .filter((id: string | null): id is string => id !== null);

  if (userIds.length === 0) {
    return [];
  }

  // For each user, get their stats
  const userStats = await Promise.all(
    userIds.map(async (userId: string) => {
      const userChatbotWhere = { ...themeChatbotWhere, user_id: userId };
      const userSupportWhere = { ...themeSupportWhere, user_id: userId };

      const [
        questionCount,
        sessions,
        idkCount,
        supportRequestCount,
      ] = await Promise.all([
        prisma.customer_support_chatbot_ai.count({ where: userChatbotWhere }),
        prisma.customer_support_chatbot_ai.groupBy({
          by: ['session_id'],
          where: userChatbotWhere,
        }),
        prisma.customer_support_chatbot_ai.count({
          where: {
            ...userChatbotWhere,
            answer: {
              contains: 'idk',
              mode: 'insensitive',
            },
          },
        }),
        prisma.support_requests.count({ where: userSupportWhere }),
      ]);

      return {
        userId,
        sessionCount: sessions.filter((s: { session_id: string | null }) => s.session_id !== null).length,
        questionCount,
        idkCount,
        supportRequestCount,
      };
    })
  );

  // Sort by question count descending
  return userStats.sort((a, b) => b.questionCount - a.questionCount);
};

export interface HourlyMetric {
  hour: string; // ISO string of the hour
  questions: number;
  sessions: number;
  maxDuration: number;
  minDuration: number;
  idk: number;
  supportRequests: number;
  tokensSent: number;
  tokensReceived: number;
  tokensTotal: number;
}

// Helper function to generate all hours in a time range
const generateHourRanges = (from?: Date, to?: Date): Date[] => {
  const hours: Date[] = [];
  
  if (!from || !to) {
    return hours;
  }
  
  // Round down to the start of the hour
  const start = new Date(from);
  start.setMinutes(0, 0, 0);
  start.setSeconds(0, 0);
  start.setMilliseconds(0);
  
  // Round up to the start of the next hour
  const end = new Date(to);
  end.setMinutes(0, 0, 0);
  end.setSeconds(0, 0);
  end.setMilliseconds(0);
  end.setHours(end.getHours() + 1);
  
  const current = new Date(start);
  while (current < end) {
    hours.push(new Date(current));
    current.setHours(current.getHours() + 1);
  }
  
  return hours;
};

// Helper function to generate all days in a time range
const generateDayRanges = (from?: Date, to?: Date): Date[] => {
  const days: Date[] = [];
  
  if (!from || !to) {
    return days;
  }
  
  // Round down to the start of the day
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  
  // Round up to the start of the next day
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  
  const current = new Date(start);
  while (current < end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return days;
};

// Helper to format hour for grouping
const formatHourForGrouping = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:00:00`;
};

// Helper to format day for grouping
const formatDayForGrouping = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const fetchHourlyMetrics = async (filters: SummaryFilters): Promise<HourlyMetric[]> => {
  // Check if we should aggregate by day (for 30D and All)
  const aggregateByDay = filters.timeRange === '30d' || filters.timeRange === 'all';
  
  // First, determine the time range
  let from: Date;
  let to: Date = filters.to || new Date();
  
  if (filters.from) {
    from = filters.from;
  } else {
    // If no from date, get the earliest data point
    const earliestQuestion = await prisma.customer_support_chatbot_ai.findFirst({
      orderBy: { date_asked: 'asc' },
      select: { date_asked: true },
    });
    const earliestSupport = await prisma.support_requests.findFirst({
      orderBy: { date_added: 'asc' },
      select: { date_added: true },
    });
    
    const dates = [earliestQuestion?.date_asked, earliestSupport?.date_added].filter(
      (d): d is Date => d !== null
    );
    
    if (dates.length === 0) {
      return [];
    }
    
    from = new Date(Math.min(...dates.map(d => d.getTime())));
  }
  
  let timeRanges: Date[];
  let toQuery: Date;
  
  if (aggregateByDay) {
    // Round down to the start of the day
    from = new Date(from);
    from.setHours(0, 0, 0, 0);
    
    to = new Date(to);
    to.setHours(0, 0, 0, 0);
    
    // For querying, include data up to the end of the last day
    toQuery = new Date(to);
    toQuery.setHours(23, 59, 59, 999);
    
    // Generate all days in the range
    const toForRange = new Date(to);
    toForRange.setDate(toForRange.getDate() + 1);
    timeRanges = generateDayRanges(from, toForRange);
  } else {
    // Round down to the start of the hour
    from = new Date(from);
    from.setMinutes(0, 0, 0);
    from.setSeconds(0, 0);
    from.setMilliseconds(0);
    
    // Round down to the start of the hour for to
    const toStartOfHour = new Date(to);
    toStartOfHour.setMinutes(0, 0, 0);
    toStartOfHour.setSeconds(0, 0);
    toStartOfHour.setMilliseconds(0);
    
    // For querying, include data up to the end of the last hour
    toQuery = new Date(toStartOfHour);
    toQuery.setMinutes(59, 59, 999);
    
    // Generate all hours in the range
    const toForRange = new Date(toStartOfHour);
    toForRange.setHours(toForRange.getHours() + 1);
    timeRanges = generateHourRanges(from, toForRange);
  }
  
  if (timeRanges.length === 0) {
    return [];
  }
  
  // Build where clauses
  const chatbotWhere = buildChatbotWhere(filters);
  const supportWhere = buildSupportRequestWhere(filters);
  
  // Get all questions
  const questionsData = await prisma.customer_support_chatbot_ai.findMany({
    where: {
      ...chatbotWhere,
      date_asked: {
        gte: from,
        lte: toQuery,
      },
    },
    select: {
      date_asked: true,
      session_id: true,
      duration: true,
      tokens_sent: true,
      tokens_received: true,
      answer: true,
    },
  });
  
  // Get all support requests
  const supportData = await prisma.support_requests.findMany({
    where: {
      ...supportWhere,
      date_added: {
        gte: from,
        lte: toQuery,
      },
    },
    select: {
      date_added: true,
    },
  });
  
  // Group data by time period (hour or day)
  const timeMap = new Map<string, {
    questions: number;
    sessions: Set<string>;
    durations: number[];
    idk: number;
    supportRequests: number;
    tokensSent: number;
    tokensReceived: number;
  }>();
  
  // Initialize all time periods with zeros
  timeRanges.forEach(timePeriod => {
    const timeKey = aggregateByDay 
      ? formatDayForGrouping(timePeriod)
      : formatHourForGrouping(timePeriod);
    timeMap.set(timeKey, {
      questions: 0,
      sessions: new Set(),
      durations: [],
      idk: 0,
      supportRequests: 0,
      tokensSent: 0,
      tokensReceived: 0,
    });
  });
  
  // Process questions
  questionsData.forEach((question: {
    date_asked: Date | null;
    session_id: string | null;
    duration: number | null;
    tokens_sent: number | null;
    tokens_received: number | null;
    answer: string | null;
  }) => {
    if (!question.date_asked) return;
    
    const questionDate = new Date(question.date_asked);
    if (aggregateByDay) {
      questionDate.setHours(0, 0, 0, 0);
    } else {
      questionDate.setMinutes(0, 0, 0);
    }
    
    const timeKey = aggregateByDay 
      ? formatDayForGrouping(questionDate)
      : formatHourForGrouping(questionDate);
    
    const timeData = timeMap.get(timeKey);
    if (!timeData) return;
    
    timeData.questions++;
    if (question.session_id) {
      timeData.sessions.add(question.session_id);
    }
    if (question.duration !== null) {
      timeData.durations.push(question.duration);
    }
    if (question.answer && question.answer.toLowerCase().includes('idk')) {
      timeData.idk++;
    }
    if (question.tokens_sent !== null) {
      timeData.tokensSent += question.tokens_sent;
    }
    if (question.tokens_received !== null) {
      timeData.tokensReceived += question.tokens_received;
    }
  });
  
  // Process support requests
  supportData.forEach((support: { date_added: Date | null }) => {
    if (!support.date_added) return;
    
    const supportDate = new Date(support.date_added);
    if (aggregateByDay) {
      supportDate.setHours(0, 0, 0, 0);
    } else {
      supportDate.setMinutes(0, 0, 0);
    }
    
    const timeKey = aggregateByDay 
      ? formatDayForGrouping(supportDate)
      : formatHourForGrouping(supportDate);
    
    const timeData = timeMap.get(timeKey);
    if (!timeData) return;
    
    timeData.supportRequests++;
  });
  
  // Convert to array and calculate metrics
  // For daily aggregation, set hour to start of day (00:00:00)
  const result: HourlyMetric[] = timeRanges.map(timePeriod => {
    const timeKey = aggregateByDay 
      ? formatDayForGrouping(timePeriod)
      : formatHourForGrouping(timePeriod);
    const data = timeMap.get(timeKey) || {
      questions: 0,
      sessions: new Set<string>(),
      durations: [],
      idk: 0,
      supportRequests: 0,
      tokensSent: 0,
      tokensReceived: 0,
    };
    
    const maxDuration = data.durations.length > 0 ? Math.max(...data.durations) : 0;
    const minDuration = data.durations.length > 0 ? Math.min(...data.durations) : 0;
    
    // For daily aggregation, ensure the hour is set to start of day
    const resultDate = new Date(timePeriod);
    if (aggregateByDay) {
      resultDate.setHours(0, 0, 0, 0);
    }
    
    return {
      hour: resultDate.toISOString(),
      questions: data.questions,
      sessions: data.sessions.size,
      maxDuration,
      minDuration,
      idk: data.idk,
      supportRequests: data.supportRequests,
      tokensSent: data.tokensSent,
      tokensReceived: data.tokensReceived,
      tokensTotal: data.tokensSent + data.tokensReceived,
    };
  });
  
  return result;
};

export interface CommentFilters {
  is_bug_fixed?: boolean;
  user_name?: string;
  from?: Date;
  to?: Date;
}

export interface Comment {
  id: number;
  user_name: string;
  question_id: number;
  question_session_id: string;
  is_answer_in_db: boolean;
  is_answer_in_context: boolean;
  date_added: Date;
  is_bug_fixed: boolean;
  issue_description: string | null;
  solution_suggestion: string | null;
}

export interface CreateCommentInput {
  user_name: string;
  question_id: number;
  question_session_id: string;
  is_answer_in_db: boolean;
  is_answer_in_context: boolean;
  issue_description?: string | null;
  solution_suggestion?: string | null;
}

export interface UpdateCommentInput {
  user_name?: string;
  is_answer_in_db?: boolean;
  is_answer_in_context?: boolean;
  is_bug_fixed?: boolean;
  issue_description?: string | null;
  solution_suggestion?: string | null;
}

const buildCommentWhere = ({ is_bug_fixed, user_name, from, to }: CommentFilters) => ({
  ...(is_bug_fixed !== undefined ? { is_bug_fixed } : {}),
  ...(user_name ? { user_name: { contains: user_name, mode: 'insensitive' as const } } : {}),
  ...(from || to
    ? {
        date_added: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      }
    : {}),
});

export const createComment = async (data: CreateCommentInput): Promise<Comment> => {
  const comment = await prisma.comments.create({
    data: {
      user_name: data.user_name,
      question_id: data.question_id,
      question_session_id: data.question_session_id,
      is_answer_in_db: data.is_answer_in_db,
      is_answer_in_context: data.is_answer_in_context,
      issue_description: data.issue_description ?? null,
      solution_suggestion: data.solution_suggestion ?? null,
    },
  });
  return comment;
};

export const updateComment = async (id: number, data: UpdateCommentInput): Promise<Comment> => {
  const comment = await prisma.comments.update({
    where: { id },
    data: {
      ...(data.user_name !== undefined ? { user_name: data.user_name } : {}),
      ...(data.is_answer_in_db !== undefined ? { is_answer_in_db: data.is_answer_in_db } : {}),
      ...(data.is_answer_in_context !== undefined ? { is_answer_in_context: data.is_answer_in_context } : {}),
      ...(data.is_bug_fixed !== undefined ? { is_bug_fixed: data.is_bug_fixed } : {}),
      ...(data.issue_description !== undefined ? { issue_description: data.issue_description } : {}),
      ...(data.solution_suggestion !== undefined ? { solution_suggestion: data.solution_suggestion } : {}),
    },
  });
  return comment;
};

export const getAllComments = async (filters: CommentFilters = {}): Promise<Comment[]> => {
  const where = buildCommentWhere(filters);
  const comments = await prisma.comments.findMany({
    where,
    orderBy: {
      date_added: 'desc',
    },
  });
  return comments;
};

export const getCommentById = async (id: number): Promise<Comment | null> => {
  const comment = await prisma.comments.findUnique({
    where: { id },
  });
  return comment;
};

export interface KnowledgeBaseItem {
  id: number;
  url: string;
  type: string;
  question: string | null;
  answer: string | null;
  categories: string[] | null;
  date_added: Date;
}

export interface CreateKnowledgeBaseInput {
  question: string;
  answer: string;
  url?: string | null;
  categories?: string[] | null;
}

export interface UpdateKnowledgeBaseInput {
  question?: string;
  answer?: string;
  url?: string | null;
  categories?: string[] | null;
}

export const getAllKnowledgeBaseItems = async (): Promise<KnowledgeBaseItem[]> => {
  const items = await prisma.customer_support_chatbot_data.findMany({
    orderBy: {
      id: 'desc',
    },
  });
  return items;
};

export const createKnowledgeBaseItem = async (data: CreateKnowledgeBaseInput): Promise<KnowledgeBaseItem> => {
  const question = (data.question || '').trim();
  const answer = (data.answer || '').trim();
  
  if (!question || !answer) {
    throw new Error('question and answer must not be empty');
  }

  const url = (data.url || '').trim() || 'manual-entry';
  const categories = (data.categories || []).filter(c => c && c.trim()).map(c => c.trim());

  const item = await prisma.customer_support_chatbot_data.create({
    data: {
      question,
      answer,
      url,
      type: 'manual',
      categories: categories, // Use empty array instead of null for Prisma String[]
    },
  });
  return item;
};

export const updateKnowledgeBaseItem = async (id: number, data: UpdateKnowledgeBaseInput): Promise<KnowledgeBaseItem> => {
  // First, get the existing item to preserve values for fields not being updated
  const existing = await prisma.customer_support_chatbot_data.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error('Knowledge base item not found');
  }

  // Prepare update data - only include fields that are provided
  const updateData: {
    question?: string;
    answer?: string;
    url?: string;
    categories?: string[] | null;
    date_added: Date;
  } = {
    date_added: new Date(),
  };

  // Handle question - use provided value or keep existing
  if (data.question !== undefined) {
    const question = data.question.trim();
    if (!question) {
      throw new Error('question must not be empty');
    }
    updateData.question = question;
  } else {
    updateData.question = existing.question;
  }

  // Handle answer - use provided value or keep existing
  if (data.answer !== undefined) {
    const answer = data.answer.trim();
    if (!answer) {
      throw new Error('answer must not be empty');
    }
    updateData.answer = answer;
  } else {
    updateData.answer = existing.answer;
  }

  // Handle url - use provided value or keep existing
  if (data.url !== undefined) {
    updateData.url = (data.url || '').trim() || 'manual-entry';
  } else {
    updateData.url = existing.url;
  }

  // Handle categories - use provided value or keep existing
  if (data.categories !== undefined) {
    const categories = (data.categories || []).filter(c => c && c.trim()).map(c => c.trim());
    updateData.categories = categories; // Use empty array instead of null for Prisma String[]
  } else {
    updateData.categories = existing.categories || []; // Ensure it's never null
  }

  const item = await prisma.customer_support_chatbot_data.update({
    where: { id },
    data: updateData,
  });
  return item;
};

export const getKnowledgeBaseItemById = async (id: number): Promise<KnowledgeBaseItem | null> => {
  const item = await prisma.customer_support_chatbot_data.findUnique({
    where: { id },
  });
  return item;
};