import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  redact: {
    paths: ['botToken', 'apiKey', 'webhookSecret', 'password', 'passwordHash', 'botTokenEnc', 'apiKeyEnc', 'webhookSecretEnc'],
    censor: '[REDACTED]',
  },
});
