import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export const useSupportRequests = () =>
  useQuery({
    queryKey: ['support-requests'],
    queryFn: async () => {
      const response = await api.get('/support-requests');
      return response.data;
    },
    staleTime: 60_000,
  });