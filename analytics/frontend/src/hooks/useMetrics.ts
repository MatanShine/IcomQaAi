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
  averageSentTokens: number;
  averageReceivedTokens: number;
  averageTotalTokens: number;
  supportRequestSessionPercentage: number;
  idkMessagePercentage: number;
}

export interface SessionInteraction {
  id: number;
  question: string;
  answer: string;
}

export interface RecentSession {
  sessionId: string;
  interactions: SessionInteraction[];
}

export const useSummaryMetrics = (filters: MetricsFilters = {}) =>
  useQuery<SummaryMetrics>({
    queryKey: ['metrics', 'summary', filters],
    queryFn: async () => {
      const response = await api.get('/metrics/summary', { params: filters });
      return response.data;
    },
    staleTime: 60_000,
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
