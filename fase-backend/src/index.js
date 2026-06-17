import 'dotenv/config';

import cors from 'cors';
import express from 'express';

import { initFirebase } from './config/firebase.js';
import adminRouter from './routes/admin.js';
import healthRouter from './routes/health.js';
import paymentsRouter from './routes/payments.js';
import pushRouter from './routes/push.js';
import validateRouter from './routes/validate.js';
import webhooksRouter from './routes/webhooks.js';

initFirebase();

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());

// Stripe webhooks require the raw body for signature verification
app.use('/webhook', express.raw({ type: 'application/json' }), webhooksRouter);

app.use(express.json());

app.use(healthRouter);
app.use(paymentsRouter);
app.use(pushRouter);
app.use(validateRouter);
app.use(adminRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, _req, res, _next) => {
  console.error('[server]', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.info(`Fase backend listening on port ${port}`);
});
