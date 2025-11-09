import { Router } from 'express';
import { z } from 'zod';
import { getSupportRequests } from '../services/supportRequestsService';

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  theme: z.string().optional(),
  userId: z.string().optional(),
});

export const supportRequestsRouter = Router();

supportRequestsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = querySchema.parse(req.query);
    const filters = {
      ...parsed,
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    };

    const requests = await getSupportRequests(filters);
    res.json(requests);
  } catch (error) {
    next(error);
  }
});
