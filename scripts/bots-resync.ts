import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { decrypt } from '../src/lib/crypto.js';
import { botManager } from '../src/modules/bot/bot-manager.js';
import { logger } from '../src/lib/logger.js';
import { env } from '../src/config/env.js';
import axios from 'axios';

/**
 * Script: pnpm bots:resync
 * Re-registers Telegram webhooks for all active bots.
 * Use after changing APP_URL or when webhooks may be out of sync.
 */
async function resyncBots(): Promise<void> {
  logger.info('Starting bot resync...');

  const integrations = await prisma.integration.findMany({
    where: { botActive: true },
    include: { user: { select: { status: true } } },
  });

  let success = 0;
  let failed = 0;

  for (const integration of integrations) {
    if (integration.user.status !== 'ACTIVE') {
      logger.warn({ integrationId: integration.id }, 'Skipping blacklisted user');
      continue;
    }

    try {
      const botToken = decrypt(integration.botTokenEnc);
      const webhookUrl = `${env.APP_URL}/telegram/${integration.botKey}`;

      await axios.post(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          url: webhookUrl,
          secret_token: integration.telegramSecret,
          allowed_updates: ['message', 'callback_query'],
        },
        { timeout: 10_000 },
      );

      logger.info({ botKey: integration.botKey, webhookUrl }, 'Webhook re-registered');
      success++;
    } catch (err) {
      logger.error({ err, integrationId: integration.id }, 'Failed to resync bot webhook');
      failed++;
    }
  }

  logger.info({ success, failed }, 'Bot resync complete');
  await prisma.$disconnect();
}

resyncBots().catch((err) => {
  logger.error({ err }, 'Resync script failed');
  process.exit(1);
});
