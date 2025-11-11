import { Router } from 'express';
import { z } from 'zod';
import { getRecentSessions, getSummaryMetrics } from '../services/metricsService';

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

metricsRouter.get('/sessions/recent', async (req, res, next) => {
  try {
    const parsed = querySchema.parse(req.query);
    const filters = {
      ...parsed,
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    };

    const sessions = await getRecentSessions(filters);
    res.json(sessions);
  } catch (error) {
    next(error);
  }
});