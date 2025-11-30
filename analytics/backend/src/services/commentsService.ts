import {
  createComment as createCommentQuery,
  updateComment as updateCommentQuery,
  getAllComments as getAllCommentsQuery,
  getCommentById as getCommentByIdQuery,
  CreateCommentInput,
  UpdateCommentInput,
  CommentFilters,
  Comment,
} from '../db/queries';

export const createComment = async (data: CreateCommentInput): Promise<Comment> => {
  return createCommentQuery(data);
};

export const updateComment = async (id: number, data: UpdateCommentInput): Promise<Comment> => {
  return updateCommentQuery(id, data);
};

export const getAllComments = async (filters: CommentFilters = {}): Promise<Comment[]> => {
  return getAllCommentsQuery(filters);
};

export const getCommentById = async (id: number): Promise<Comment | null> => {
  return getCommentByIdQuery(id);
};


