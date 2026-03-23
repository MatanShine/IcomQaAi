import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PromptVersion, ComparisonMetrics } from '../types/prompts';

export const usePromptVersions = (promptType?: string) =>
  useQuery<PromptVersion[]>({
    queryKey: ['prompts', promptType],
    queryFn: async () => {
      const params = promptType ? { type: promptType } : {};
      const response = await api.get('/prompts', { params });
      return response.data;
    },
    staleTime: 30_000,
  });

export const usePromptVersion = (id: number | null) =>
  useQuery<PromptVersion>({
    queryKey: ['prompts', 'detail', id],
    queryFn: async () => {
      const response = await api.get(`/prompts/${id}`);
      return response.data;
    },
    enabled: id !== null,
    staleTime: 30_000,
  });

export const useCreatePrompt = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, { prompt_type: string; name: string; content: string }>({
    mutationFn: async (data) => {
      const response = await api.post('/prompts', data);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useUpdatePrompt = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, { id: number; data: { name?: string; content?: string } }>({
    mutationFn: async ({ id, data }) => {
      const response = await api.put(`/prompts/${id}`, data);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const usePublishPrompt = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, number>({
    mutationFn: async (id) => {
      const response = await api.post(`/prompts/${id}/publish`);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useSetPromptTesting = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, number>({
    mutationFn: async (id) => {
      const response = await api.post(`/prompts/${id}/test`);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useStopPromptTesting = () => {
  const qc = useQueryClient();
  return useMutation<PromptVersion, Error, number>({
    mutationFn: async (id) => {
      const response = await api.post(`/prompts/${id}/stop-test`);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};

export const useComparePrompts = (idA: number | null, idB: number | null) =>
  useQuery<ComparisonMetrics[]>({
    queryKey: ['prompts', 'compare', idA, idB],
    queryFn: async () => {
      const response = await api.get('/prompts/compare', { params: { ids: `${idA},${idB}` } });
      return response.data;
    },
    enabled: idA !== null && idB !== null,
    staleTime: 30_000,
  });

export const useSeedPrompts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prompts: { prompt_type: string; name: string; content: string }[]) => {
      const response = await api.post('/prompts/seed', { prompts });
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
};
