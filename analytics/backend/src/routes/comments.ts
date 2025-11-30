import { Router } from 'express';
import { z } from 'zod';
import { createComment, updateComment, getAllComments, getCommentById } from '../services/commentsService';

const createCommentSchema = z.object({
  user_name: z.string().min(1),
  question_id: z.number().int().positive(),
  question_session_id: z.string().min(1),
  is_answer_in_db: z.boolean(),
  is_answer_in_context: z.boolean(),
  issue_description: z.string().optional().nullable(),
  solution_suggestion: z.string().optional().nullable(),
});

const updateCommentSchema = z.object({
  user_name: z.string().min(1).optional(),
  is_answer_in_db: z.boolean().optional(),
  is_answer_in_context: z.boolean().optional(),
  is_bug_fixed: z.boolean().optional(),
  issue_description: z.string().optional().nullable(),
  solution_suggestion: z.string().optional().nullable(),
});

const querySchema = z.object({
  is_bug_fixed: z.string().optional().transform((val) => val === 'true' ? true : val === 'false' ? false : undefined),
  user_name: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const commentsRouter = Router();

commentsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createCommentSchema.parse(req.body);
    const comment = await createComment(parsed);
    res.json(comment);
  } catch (error) {
    next(error);
  }
});

commentsRouter.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }
    const parsed = updateCommentSchema.parse(req.body);
    const comment = await updateComment(id, parsed);
    res.json(comment);
  } catch (error) {
    next(error);
  }
});

commentsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = querySchema.parse(req.query);
    const filters = {
      ...parsed,
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    };
    const comments = await getAllComments(filters);
    res.json(comments);
  } catch (error) {
    next(error);
  }
});

commentsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }
    const comment = await getCommentById(id);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.json(comment);
  } catch (error) {
    next(error);
  }
});


