import type { Router } from 'express';
import { Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireAuth, requireAdmin } from '../auth/auth.middleware.js';
import { deactivateOnBlacklist } from '../dashboard/integration.service.js';
import { generateToken } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';

export const adminRouter: Router = ExpressRouter();
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

// ─── Dashboard Summary ────────────────────────────────────────────────────────

const ERROR_EVENT_TYPES = ['WEBHOOK_ERROR', 'BOT_ERROR', 'AUTOSTORE_ERROR', 'DELIVERY_FAILED'];

adminRouter.get('/stats', async (_req: Request, res: Response) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalUsers, activeUsers, blacklistedUsers, activeBots, ordersToday, recentErrorsCount, recentErrors] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'BLACKLISTED' } }),
    prisma.integration.count({ where: { botActive: true } }),
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.integrationEvent.count({
      where: { type: { in: ERROR_EVENT_TYPES }, createdAt: { gte: last24h } },
    }),
    prisma.integrationEvent.findMany({
      where: { type: { in: ERROR_EVENT_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { integration: { select: { userId: true, botUsername: true } } },
    }),
  ]);

  res.json({ totalUsers, activeUsers, blacklistedUsers, activeBots, ordersToday, recentErrorsCount, recentErrors });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

async function isRegistrationEnabled(): Promise<boolean> {
  const setting = await prisma.setting.findUnique({ where: { key: 'registrationEnabled' } });
  return setting?.value !== 'false';
}

adminRouter.get('/settings', async (_req: Request, res: Response) => {
  res.json({ registrationEnabled: await isRegistrationEnabled() });
});

const settingsSchema = z.object({ registrationEnabled: z.boolean() });

adminRouter.post('/settings', async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Input tidak valid.' });
    return;
  }
  const value = String(parsed.data.registrationEnabled);
  await prisma.setting.upsert({
    where: { key: 'registrationEnabled' },
    update: { value },
    create: { key: 'registrationEnabled', value },
  });
  res.json({ ok: true, registrationEnabled: parsed.data.registrationEnabled });
});

// ─── User List ────────────────────────────────────────────────────────────────

adminRouter.get('/users', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const limit = 20;
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;

  const where = search
    ? { OR: [{ username: { contains: search } }, { email: { contains: search } }] }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        integration: {
          select: {
            botActive: true,
            botUsername: true,
            _count: { select: { orders: true } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const items = users.map(({ integration, ...u }) => ({
    ...u,
    botActive: integration?.botActive ?? false,
    botUsername: integration?.botUsername ?? null,
    orderCount: integration?._count.orders ?? 0,
  }));

  res.json({ users: items, total, page, pages: Math.ceil(total / limit) });
});

// ─── User Detail ──────────────────────────────────────────────────────────────

adminRouter.get('/users/:id', async (req: Request, res: Response) => {
  const targetId = parseInt(req.params.id as string);
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      blacklistReason: true,
      lastLoginAt: true,
      createdAt: true,
      integration: {
        select: {
          id: true,
          botUsername: true,
          autostoreUrl: true,
          botActive: true,
          lastCallbackAt: true,
          lastError: true,
          createdAt: true,
          // Explicitly NOT including botTokenEnc, apiKeyEnc, webhookSecretEnc
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              invoiceCode: true,
              productName: true,
              qty: true,
              amount: true,
              status: true,
              createdAt: true,
            },
          },
          events: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      },
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User tidak ditemukan.' });
    return;
  }

  res.json(user);
});

// ─── Blacklist ────────────────────────────────────────────────────────────────

const blacklistSchema = z.object({ reason: z.string().max(500).optional() });

adminRouter.post('/users/:id/blacklist', async (req: Request, res: Response) => {
  const adminId = req.userId!;
  const targetId = parseInt(req.params.id as string);
  const parsed = blacklistSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    include: { integration: true },
  });
  if (!target) {
    res.status(404).json({ error: 'User tidak ditemukan.' });
    return;
  }
  if (target.role === 'ADMIN') {
    res.status(400).json({ error: 'Admin tidak bisa di-blacklist.' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Blacklist user
    await tx.user.update({
      where: { id: targetId },
      data: { status: 'BLACKLISTED', blacklistReason: parsed.data.reason ?? null },
    });
    // Delete all sessions
    await tx.session.deleteMany({ where: { userId: targetId } });
    // Audit log
    await tx.adminAuditLog.create({
      data: {
        adminId,
        targetUserId: targetId,
        action: 'BLACKLIST',
        reason: parsed.data.reason,
      },
    });
  });

  // Deactivate bot outside transaction (may call external API)
  if (target.integration) {
    await deactivateOnBlacklist(target.integration).catch((err) =>
      logger.error({ err, targetId }, 'Error deactivating bot on blacklist'),
    );
  }

  res.json({ ok: true });
});

// ─── Unblacklist ──────────────────────────────────────────────────────────────

adminRouter.post('/users/:id/unblacklist', async (req: Request, res: Response) => {
  const adminId = req.userId!;
  const targetId = parseInt(req.params.id as string);
  const parsed = blacklistSchema.safeParse(req.body);

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    res.status(404).json({ error: 'User tidak ditemukan.' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetId },
      data: { status: 'ACTIVE', blacklistReason: null },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId,
        targetUserId: targetId,
        action: 'UNBLACKLIST',
        reason: parsed.success ? parsed.data.reason : undefined,
      },
    });
  });

  res.json({ ok: true });
});

// ─── Reset Password ───────────────────────────────────────────────────────────

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).optional(),
});

adminRouter.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  const adminId = req.userId!;
  const targetId = parseInt(req.params.id as string);
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    res.status(404).json({ error: 'User tidak ditemukan.' });
    return;
  }

  // Generate random password if not provided
  const newPassword = parsed.data.newPassword ?? generateToken(8).slice(0, 12);
  const passwordHash = await argon2.hash(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: targetId } });
    await tx.adminAuditLog.create({
      data: {
        adminId,
        targetUserId: targetId,
        action: 'RESET_PASSWORD',
        reason: 'Admin reset password',
      },
    });
  });

  // Return new password only once (if auto-generated)
  res.json({
    ok: true,
    ...(parsed.data.newPassword ? {} : { generatedPassword: newPassword }),
  });
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

adminRouter.get('/audit', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const limit = 50;
  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.adminAuditLog.count(),
  ]);

  // Resolve usernames for display (audit rows only store ids)
  const ids = [...new Set(logs.flatMap((l) => [l.adminId, l.targetUserId]))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } });
  const names = new Map(users.map((u) => [u.id, u.username]));

  res.json({
    logs: logs.map((l) => ({
      ...l,
      adminUsername: names.get(l.adminId) ?? null,
      targetUsername: names.get(l.targetUserId) ?? null,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});
