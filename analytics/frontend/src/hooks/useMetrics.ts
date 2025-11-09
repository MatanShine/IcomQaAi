import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export const useSummaryMetrics = () =>
  useQuery({
    queryKey: ['metrics', 'summary'],
    queryFn: async () => {
      const response = await api.get('/metrics/summary');
      return response.data;
    },
    staleTime: 60_000,
  });

export const useIdkSessions = () =>
  useQuery({
    queryKey: ['metrics', 'idk-sessions'],
    queryFn: async () => {
      const response = await api.get('/metrics/idk/sessions');
      return response.data;
    },
    staleTime: 60_000,
  });
