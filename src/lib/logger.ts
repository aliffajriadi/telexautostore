import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Error serializer that drops axios internals. An AxiosError carries `config`
 * (request headers with API keys, request body with webhook secrets, and
 * Telegram URLs containing the bot token) plus `request`/`response` sockets.
 * Keep only what helps debugging: message, stack, HTTP status and a short body.
 */
export function errSerializer(err: unknown) {
  const out = pino.stdSerializers.err(err as Error) as unknown as Record<string, unknown>;
  if (!out || typeof out !== 'object') return out;
  const response = (err as { response?: { status?: number; data?: unknown } })?.response;
  delete out.config;
  delete out.request;
  delete out.response;
  if (response?.status) out.status = response.status;
  if (response?.data !== undefined) {
    out.responseBody = (typeof response.data === 'string' ? response.data : JSON.stringify(response.data)).slice(0, 500);
  }
  return out;
}

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  serializers: { err: errSerializer },
  redact: {
    paths: ['botToken', 'apiKey', 'webhookSecret', 'password', 'passwordHash', 'botTokenEnc', 'apiKeyEnc', 'webhookSecretEnc'],
    censor: '[REDACTED]',
  },
});
