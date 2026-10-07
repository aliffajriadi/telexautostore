import type { RequestHandler } from 'express';
import { isProd } from '../config/env.js';
import { generateToken, safeCompareHmac } from './crypto.js';

// Double-submit cookie. The names match axios' defaults, so the frontend
// echoes the cookie back in the header without extra code.
export const CSRF_COOKIE = 'XSRF-TOKEN';
export const CSRF_HEADER = 'x-xsrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Issues a CSRF cookie when missing and rejects state-changing requests
 * whose X-XSRF-TOKEN header does not match the cookie.
 */
export const csrfProtection: RequestHandler = (req, res, next) => {
  let token = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    token = generateToken(32);
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // must be readable by the frontend
      secure: isProd,
      sameSite: 'lax',
      path: '/',
    });
    // A freshly issued token can't have been echoed back yet
    if (!SAFE_METHODS.has(req.method)) {
      res.status(403).json({ error: 'Sesi formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.' });
      return;
    }
  }

  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const header = req.get(CSRF_HEADER);
  if (!header || !safeCompareHmac(header, token)) {
    res.status(403).json({ error: 'Token CSRF tidak valid. Muat ulang halaman lalu coba lagi.' });
    return;
  }
  next();
};
