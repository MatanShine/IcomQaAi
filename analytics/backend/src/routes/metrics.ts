import { Router } from 'express';
import { z } from 'zod';
import { getIdkSessions, getSummaryMetrics } from '../services/metricsService';

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  theme: z.string().optional(),
  userId: z.string().optional(),
});

export const metricsRouter = Router();

metricsRouter.get('/summary', async (req, res, next) => {
  try {
    const parsed = querySchema.parse(req.query);
    const filters = {
      ...parsed,
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    };
    const metrics = await getSummaryMetrics(filters);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

metricsRouter.get('/idk/sessions', async (_req, res, next) => {
  try {
    const sessions = await getIdkSessions();
    res.json(sessions);
  } catch (error) {
    next(error);
  }
});