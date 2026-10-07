import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { decrypt } from './lib/crypto.js';
import { botManager } from './modules/bot/bot-manager.js';
import { authRouter } from './modules/auth/auth.router.js';
import { dashboardRouter } from './modules/dashboard/dashboard.router.js';
import { adminRouter } from './modules/admin/admin.router.js';
import { telegramRouter } from './modules/bot/telegram.router.js';
import { webhookRouter } from './modules/webhook/webhook.router.js';
import { startOrderExpiryJob, startSessionCleanupJob, startDeliveryRetryJob } from './lib/jobs.js';
import cors from 'cors';
import { csrfProtection } from './lib/csrf.js';

const app: express.Express = express();

// Trust proxy (required for ngrok/cloudflare and express-rate-limit)
app.set('trust proxy', 1);

// ─── Raw body capture (for webhook HMAC verification) ────────────────────────
app.use(
  express.json({
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: env.APP_URL,
    credentials: true,
  }),
);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ─── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi setelah 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Terlalu banyak pendaftaran dari IP ini.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Telegram webhook (no auth, rate limited)
app.use('/telegram', telegramRouter);

// AutoStore callback webhook
app.use('/webhook/autostore', webhookLimiter, webhookRouter);

// CSRF protection for all cookie-authenticated API routes
app.use('/api', csrfProtection);

// Auth routes
app.post('/api/login', authLimiter);
app.post('/api/register', registerLimiter);
app.use('/api', authRouter);

// Protected routes
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin', adminRouter);

// Unknown API routes → JSON 404 (never fall through to the SPA)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route tidak ditemukan.' });
});

// ─── Serve Frontend (SPA) ───────────────────────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/') || req.path.startsWith('/telegram/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ─── 404 for API ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route tidak ditemukan.' });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');

  // Load all active bots
  const activeIntegrations = await prisma.integration.findMany({
    where: { botActive: true },
    include: { user: { select: { status: true } } },
  });

  const toSync = activeIntegrations
    .filter((i) => i.user.status === 'ACTIVE')
    .map((i) => ({ integration: i, botToken: decrypt(i.botTokenEnc) }));

  await botManager.resyncAll(toSync);
  logger.info({ count: toSync.length }, 'Bots loaded');

  // Start background jobs
  startOrderExpiryJob();
  startSessionCleanupJob();
  startDeliveryRetryJob();

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, url: env.APP_URL }, '🚀 Server started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});

export { app };
