import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/auth.js';
import { rateLimiter } from './middleware/rateLimit.js';
import messagesRouter from './routes/messages.js';
import { logger } from './utils/logger.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: '*', // Tighten this in production if desired
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization', 'anthropic-version'],
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);

// ── Trust proxy (needed for correct req.ip behind load balancers / Nginx) ────
app.set('trust proxy', 1);

// ── Rate limiter (applied globally before auth so it also covers health) ─────
app.use(rateLimiter);

// ── Health check (unauthenticated) ───────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Authenticated routes ──────────────────────────────────────────────────────
app.use('/v1/messages', authMiddleware, messagesRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { type: 'not_found', message: 'Route not found.' } });
});

// ── Centralized error handler ─────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', {
    message: err.message,
    path: req.path,
    // Only include stack in development
    ...(IS_PROD ? {} : { stack: err.stack }),
  });

  // Surface Bedrock / AWS SDK errors with a sensible status code
  const status = err.$metadata?.httpStatusCode ?? err.statusCode ?? 500;

  res.status(status).json({
    error: {
      type: 'api_error',
      message: IS_PROD ? 'An internal error occurred.' : err.message,
    },
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`bedrock-claude-proxy listening`, { port: PORT, env: process.env.NODE_ENV || 'development' });
});
