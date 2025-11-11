import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface MetricsFilters {
  from?: string;
  to?: string;
  theme?: string;
  userId?: string;
}

export interface SummaryMetrics {
  totalQuestions: number;
  totalSessions: number;
  uniqueUsers: number;
  totalIdk: number;
  averageDuration: number;
  averageQuestionsPerSession: number;
  averageIdkPerSession: number;
  averageTotalTokens: number;
  supportRequestSessionPercentage: number;
  idkMessagePercentage: number;
  idkSessionPercentage: number;
  idkAndSupportRequestSessionPercentage: number;
}

export interface SessionInteraction {
  id: number;
  question: string;
  answer: string;
  context?: string | null;
}

export interface RecentSession {
  sessionId: string;
  userId: string | null;
  theme: string | null;
  interactions: SessionInteraction[];
  hasSupportRequest: boolean;
  lastQuestionTime: string | null;
}

export const useSummaryMetrics = (filters: MetricsFilters = {}, previousPeriodFilters?: MetricsFilters | null) =>
  useQuery<SummaryMetrics>({
    queryKey: ['metrics', 'summary', filters],
    queryFn: async () => {
      const response = await api.get('/metrics/summary', { params: filters });
      return response.data;
    },
    staleTime: 60_000,
  });

export const usePreviousPeriodMetrics = (previousPeriodFilters: MetricsFilters | null | undefined) =>
  useQuery<SummaryMetrics | null>({
    queryKey: ['metrics', 'summary', 'previous', previousPeriodFilters],
    queryFn: async () => {
      if (!previousPeriodFilters) {
        return null;
      }
      const response = await api.get('/metrics/summary', { params: previousPeriodFilters });
      return response.data;
    },
    staleTime: 60_000,
    enabled: !!previousPeriodFilters,
  });

export const useRecentSessions = (filters: MetricsFilters = {}) =>
  useQuery<RecentSession[]>({
    queryKey: ['metrics', 'sessions', 'recent', filters],
    queryFn: async () => {
      const response = await api.get('/metrics/sessions/recent', { params: filters });
      return response.data;
    },
    staleTime: 60_000,
  });

export const useAllSessions = (filters: MetricsFilters = {}) =>
  useQuery<RecentSession[]>({
    queryKey: ['metrics', 'sessions', 'all', filters],
    queryFn: async () => {
      const response = await api.get('/metrics/sessions/all', { params: filters });
      return response.data;
    },
    staleTime: 60_000,
  });

export interface ThemeUsageStats {
  theme: string;
  questionCount: number;
  userCount: number;
  sessionCount: number;
  idkCount: number;
  supportRequestCount: number;
}

export const useThemeUsageStats = (filters: MetricsFilters = {}) =>
  useQuery<ThemeUsageStats[]>({
    queryKey: ['metrics', 'themes', 'usage', filters],
    queryFn: async () => {
      const response = await api.get('/metrics/themes/usage', { params: filters });
      return response.data;
    },
    staleTime: 60_000,
  });

export interface UserThemeStats {
  userId: string;
  sessionCount: number;
  questionCount: number;
  idkCount: number;
  supportRequestCount: number;
}

export const useUsersByTheme = (theme: string | null, filters: MetricsFilters = {}) =>
  useQuery<UserThemeStats[]>({
    queryKey: ['metrics', 'themes', theme, 'users', filters],
    queryFn: async () => {
      if (!theme) {
        return [];
      }
      const response = await api.get(`/metrics/themes/${encodeURIComponent(theme)}/users`, { params: filters });
      return response.data;
    },
    staleTime: 60_000,
    enabled: !!theme,
  });

export interface HourlyMetric {
  hour: string;
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

export const useHourlyMetrics = (filters: MetricsFilters = {}, timeRange?: string) =>
  useQuery<HourlyMetric[]>({
    queryKey: ['metrics', 'hourly', filters, timeRange],
    queryFn: async () => {
      const response = await api.get('/metrics/hourly', { params: { ...filters, timeRange } });
      return response.data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000, // Refetch every minute for "live" updates
  });
