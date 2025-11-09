import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { metricsRouter } from './routes/metrics';
import { supportRequestsRouter } from './routes/supportRequests';
import { errorHandler } from './middleware/errorHandler';
import { validateEnv } from './env';

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json());

validateEnv();

app.use('/api/metrics', metricsRouter);
app.use('/api/support-requests', supportRequestsRouter);

app.use(errorHandler);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.listen(port, () => {
  console.log(`Analytics backend listening on port ${port}`);
});
