import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import 'dotenv/config';
import helmet from 'helmet';
import { metricsRouter } from './routes/metrics';
import { commentsRouter } from './routes/comments';
import { knowledgeBaseRouter } from './routes/knowledgeBase';
import { errorHandler } from './middleware/errorHandler';
import { validateEnv } from './env';

dotenv.config();

const PORT = parseInt(process.env.PORT ?? '4001', 10);

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('DATABASE_URL is not set. The analytics backend will not be able to query the database.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
});

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
validateEnv();

app.use('/api/metrics', metricsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/knowledge-base', knowledgeBaseRouter);

app.use(errorHandler);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/api/analytics/qa', async (req: Request, res: Response) => {
  const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Number.parseInt(limitParam as string ?? '20', 10);

  if (Number.isNaN(limit) || limit <= 0) {
    return res.status(400).json({ error: 'limit must be a positive integer' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, question, answer, date_asked
       FROM customer_support_chatbot_ai
       ORDER BY date_asked DESC
       LIMIT $1`,
      [limit]
    );

    const data = rows.map((row) => ({
      id: row.id as number,
      question: row.question as string,
      answer: row.answer as string,
      dateAsked: row.date_asked instanceof Date ? row.date_asked.toISOString() : row.date_asked
    }));

    return res.json({ data });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to fetch analytics data', error);
    return res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Analytics backend listening on port ${PORT}`);
});
