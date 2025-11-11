import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface MetricsQueryParams {
  from?: string;
  to?: string;
  theme?: string;
  userId?: string;
}

const sanitizeParams = (params?: MetricsQueryParams) => {
  if (!params) {
    return undefined;
  }

  const filtered = Object.entries(params).filter(([, value]) => Boolean(value));
  return filtered.length ? Object.fromEntries(filtered) : undefined;
};

export const useSummaryMetrics = (params?: MetricsQueryParams) =>
  useQuery({
    queryKey: ['metrics', 'summary', params],
    queryFn: async () => {
      const response = await api.get('/metrics/summary', {
        params: sanitizeParams(params),
      });
      return response.data;
    },
    staleTime: 60_000,
  });

export const useIdkSessions = (params?: MetricsQueryParams) =>
  useQuery({
    queryKey: ['metrics', 'idk-sessions', params],
    queryFn: async () => {
      const response = await api.get('/metrics/idk/sessions', {
        params: sanitizeParams(params),
      });
      return response.data;
    },
    staleTime: 60_000,
  });