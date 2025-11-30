import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Comment, CommentFilters, CreateCommentInput, UpdateCommentInput } from '../types/comments';

export const useComments = (filters: CommentFilters = {}) =>
  useQuery<Comment[]>({
    queryKey: ['comments', filters],
    queryFn: async () => {
      const response = await api.get('/comments', { params: filters });
      return response.data;
    },
    staleTime: 60_000,
  });

export const useComment = (id: number) =>
  useQuery<Comment>({
    queryKey: ['comments', id],
    queryFn: async () => {
      const response = await api.get(`/comments/${id}`);
      return response.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

export const useCreateComment = () => {
  const queryClient = useQueryClient();
  return useMutation<Comment, Error, CreateCommentInput>({
    mutationFn: async (data) => {
      const response = await api.post('/comments', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
  });
};

export const useUpdateComment = () => {
  const queryClient = useQueryClient();
  return useMutation<Comment, Error, { id: number; data: UpdateCommentInput }>({
    mutationFn: async ({ id, data }) => {
      const response = await api.put(`/comments/${id}`, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['comments', variables.id] });
    },
  });
};


