import type { Router } from 'express';
import { Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { generateToken } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from './auth.middleware.js';

export const authRouter: Router = ExpressRouter();

// ─── Register ────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email().max(191),
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Password tidak cocok.',
  path: ['confirmPassword'],
});

authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    // Check if registration is enabled
    const setting = await prisma.setting.findUnique({ where: { key: 'registrationEnabled' } });
    if (setting && setting.value === 'false') {
      res.status(403).json({ error: 'Pendaftaran sementara ditutup.' });
      return;
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const { username, email, password } = parsed.data;

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (existing) {
      res.status(400).json({ error: 'Username atau email sudah digunakan.' });
      return;
    }

    const passwordHash = await argon2.hash(password);
    const user = await prisma.user.create({
      data: { username, email, passwordHash },
    });

    logger.info({ userId: user.id }, 'New user registered');
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Register error');
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── Login ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    // Generic error to avoid enumeration
    res.status(401).json({ error: 'Kredensial tidak valid.' });
    return;
  }

  const { identifier, password } = parsed.data;

  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });

    // Verify password even if user not found to avoid timing attacks
    const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$AAAA$AAAA';
    const isValid = user
      ? await argon2.verify(user.passwordHash, password)
      : await argon2.verify(dummyHash, password).catch(() => false);

    if (!user || !isValid) {
      res.status(401).json({ error: 'Kredensial tidak valid.' });
      return;
    }

    if (user.status === 'BLACKLISTED') {
      res.status(403).json({ error: 'Akun ini tidak aktif. Hubungi administrator.' });
      return;
    }

    // Create session
    const sessionId = generateToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.session.create({ data: { id: sessionId, userId: user.id, expiresAt } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
    });

    res.json({ ok: true, role: user.role });
  } catch (err) {
    logger.error({ err }, 'Login error');
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── Logout ──────────────────────────────────────────────────────────────────

authRouter.post('/logout', async (req: Request, res: Response) => {
  const sessionId = req.cookies?.session_id;
  if (sessionId) {
    await prisma.session.deleteMany({ where: { id: sessionId } }).catch(() => {});
  }
  res.clearCookie('session_id');
  res.json({ ok: true });
});

// ─── Change password ─────────────────────────────────────────────────────────

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post('/account/password', requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { oldPassword, newPassword } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: 'User tidak ditemukan.' });
      return;
    }

    const isValid = await argon2.verify(user.passwordHash, oldPassword);
    if (!isValid) {
      res.status(401).json({ error: 'Password lama tidak benar.' });
      return;
    }

    const newHash = await argon2.hash(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

    // Invalidate all sessions
    await prisma.session.deleteMany({ where: { userId } });
    res.clearCookie('session_id');
    res.json({ ok: true, message: 'Password berhasil diubah. Silakan login kembali.' });
  } catch (err) {
    logger.error({ err }, 'Change password error');
    res.status(500).json({ error: 'Internal server error.' });
  }
});
