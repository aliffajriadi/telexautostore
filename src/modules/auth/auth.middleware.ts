import type { RequestHandler } from 'express';
import { prisma } from '../../lib/prisma.js';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userRole?: string;
    }
  }
}

/**
 * Middleware: verifies session cookie and attaches userId to request.
 * Returns 401 if session is missing or expired.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    res.clearCookie('session_id');
    res.status(401).json({ error: 'Session expired. Silakan login kembali.' });
    return;
  }

  if (session.user.status === 'BLACKLISTED') {
    res.clearCookie('session_id');
    res.status(403).json({ error: 'Akun Anda telah dinonaktifkan.' });
    return;
  }

  req.userId = session.user.id;
  req.userRole = session.user.role;
  next();
};

/**
 * Middleware: requires ADMIN role. Must come after requireAuth.
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  next();
};
