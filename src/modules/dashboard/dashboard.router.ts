import type { Router } from 'express';
import { Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { validateAutoStoreUrl } from '../../lib/ssrf-guard.js';
import {
  createOrUpdateIntegration,
  validateBotToken,
  validateAutoStoreConnection,
  regenerateCallbackKey,
  toggleBot,
  getDecryptedIntegration,
} from './integration.service.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export const dashboardRouter: Router = ExpressRouter();
dashboardRouter.use(requireAuth);

// ─── GET /dashboard ───────────────────────────────────────────────────────────

dashboardRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { integration: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const integration = user.integration;
  let stats = { totalOrders: 0, successOrders: 0, totalRevenue: 0, uniqueBuyers: 0 };

  if (integration) {
    const [totalOrders, successOrders, revenue, buyers] = await Promise.all([
      prisma.order.count({ where: { integrationId: integration.id } }),
      prisma.order.count({ where: { integrationId: integration.id, status: 'DELIVERED' } }),
      prisma.order.aggregate({
        where: { integrationId: integration.id, status: { in: ['PAID', 'DELIVERED'] } },
        _sum: { amount: true },
      }),
      prisma.buyer.count({ where: { integrationId: integration.id } }),
    ]);
    stats = {
      totalOrders,
      successOrders,
      totalRevenue: revenue._sum.amount ?? 0,
      uniqueBuyers: buyers,
    };
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    integration: integration
      ? {
          id: integration.id,
          botUsername: integration.botUsername,
          autostoreUrl: integration.autostoreUrl,
          botActive: integration.botActive,
          callbackUrl: `${env.APP_URL}/webhook/autostore/${integration.callbackKey}`,
          // Mask sensitive fields
          botTokenMask: integration.botUsername ? `••••••••• (@${integration.botUsername})` : null,
          apiKeyMask: integration.apiKeyEnc ? '•••••••••••••••• (saved)' : null,
          webhookSecret: decrypt(integration.webhookSecretEnc),
          startMessage: integration.startMessage,
          startImageUrl: integration.startImageUrl,
          deliveryMessage: integration.deliveryMessage,
          lastCallbackAt: integration.lastCallbackAt,
          lastError: integration.lastError,
        }
      : null,
    stats,
  });
});

// ─── POST /dashboard/integration ─────────────────────────────────────────────

const integrationSchema = z.object({
  botToken: z.string().optional().or(z.literal('')),
  autostoreUrl: z.string().url().optional().or(z.literal('')),
  apiKey: z.string().optional().or(z.literal('')),
  startMessage: z.string().optional().or(z.literal('')),
  startImageUrl: z.string().optional().or(z.literal('')),
  deliveryMessage: z.string().max(1000, 'Pesan pengiriman maksimal 1000 karakter.').optional().or(z.literal('')),
});

dashboardRouter.post('/integration', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = integrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { botToken, autostoreUrl, apiKey, startMessage, startImageUrl, deliveryMessage } = parsed.data;
  // Empty string means "don't change"
  const data = {
    botToken: botToken?.trim() || undefined,
    autostoreUrl: autostoreUrl?.trim() || undefined,
    apiKey: apiKey?.trim() || undefined,
    startMessage: startMessage,
    startImageUrl: startImageUrl,
    deliveryMessage: deliveryMessage,
  };

  try {
    if (data.autostoreUrl) {
      await validateAutoStoreUrl(data.autostoreUrl);
    }

    const existing = await prisma.integration.findUnique({ where: { userId } });
    const integration = await createOrUpdateIntegration(userId, data, existing);

    res.json({ ok: true, integrationId: integration.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menyimpan integrasi.';
    res.status(400).json({ error: message });
  }
});

// ─── POST /dashboard/integration/test ────────────────────────────────────────

dashboardRouter.post('/integration/test', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const integration = await prisma.integration.findUnique({ where: { userId } });
  if (!integration) {
    res.status(404).json({ error: 'Integrasi belum diatur.' });
    return;
  }

  const results: { botOk?: boolean; botError?: string; autostoreOk?: boolean; autostoreError?: string } = {};

  try {
    await validateBotToken(decrypt(integration.botTokenEnc));
    results.botOk = true;
  } catch (err) {
    results.botOk = false;
    results.botError = err instanceof Error ? err.message : 'Bot check failed';
  }

  try {
    await validateAutoStoreConnection(integration.autostoreUrl, decrypt(integration.apiKeyEnc));
    results.autostoreOk = true;
  } catch (err) {
    results.autostoreOk = false;
    results.autostoreError = err instanceof Error ? err.message : 'AutoStore check failed';
  }

  res.json(results);
});

// ─── POST /dashboard/integration/regenerate-callback ─────────────────────────

dashboardRouter.post('/integration/regenerate-callback', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const integration = await prisma.integration.findUnique({ where: { userId } });
  if (!integration) {
    res.status(404).json({ error: 'Integrasi belum diatur.' });
    return;
  }

  try {
    const updated = await regenerateCallbackKey(integration.id);
    res.json({
      ok: true,
      callbackUrl: `${env.APP_URL}/webhook/autostore/${updated.callbackKey}`,
      webhookSecret: decrypt(updated.webhookSecretEnc),
    });
  } catch (err) {
    logger.error({ err, userId }, 'Error regenerating callback key');
    res.status(500).json({ error: 'Gagal regenerate callback key.' });
  }
});

// ─── POST /dashboard/bot/toggle ──────────────────────────────────────────────

dashboardRouter.post('/bot/toggle', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const integration = await prisma.integration.findUnique({ where: { userId } });
  if (!integration) {
    res.status(404).json({ error: 'Integrasi belum diatur.' });
    return;
  }

  const activate = !integration.botActive;
  try {
    await toggleBot(integration, activate);
    res.json({ ok: true, botActive: activate });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengubah status bot.';
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastError: message },
    });
    res.status(500).json({ error: message });
  }
});

// ─── GET /dashboard/orders ────────────────────────────────────────────────────

dashboardRouter.get('/orders', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const integration = await prisma.integration.findUnique({ where: { userId } });
  if (!integration) {
    res.json({ orders: [], total: 0 });
    return;
  }

  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const limit = 20;
  const skip = (page - 1) * limit;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;

  const where: object = {
    integrationId: integration.id,
    ...(status ? { status } : {}),
    ...(search
      ? { OR: [{ invoiceCode: { contains: search } }, { externalReference: { contains: search } }] }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        invoiceCode: true,
        productName: true,
        qty: true,
        amount: true,
        status: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
    prisma.order.count({ where }),
  ]);

  res.json({ orders, total, page, pages: Math.ceil(total / limit) });
});
