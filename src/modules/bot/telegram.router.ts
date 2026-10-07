import type { Router } from 'express';
import { Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { botManager } from '../bot/bot-manager.js';
import { logger } from '../../lib/logger.js';

export const telegramRouter: Router = ExpressRouter();

telegramRouter.post('/:botKey', async (req: Request, res: Response) => {
  const botKey = req.params.botKey as string;

  const entry = botManager.getHandler(botKey);
  if (!entry) {
    // Bot not in memory — check if it exists in DB but wasn't loaded
    const integration = await prisma.integration.findUnique({
      where: { botKey, botActive: true },
      include: { user: { select: { status: true } } },
    });
    if (!integration || integration.user.status !== 'ACTIVE') {
      res.status(404).end();
      return;
    }
    // Lazy load
    try {
      const { user: _user, ...intg } = integration;
      await botManager.activateBot(intg, decrypt(intg.botTokenEnc));
      const loadedEntry = botManager.getHandler(botKey);
      if (loadedEntry) {
        await loadedEntry.handleUpdate(req, res);
        return;
      }
    } catch (err) {
      logger.error({ err, botKey }, 'Failed to lazy-load bot');
      res.status(500).end();
      return;
    }
  }

  if (!entry) {
    res.status(404).end();
    return;
  }

  try {
    await entry.handleUpdate(req, res);
  } catch (err) {
    logger.error({ err, botKey }, 'Error handling Telegram update');
    res.status(200).end(); // Always return 200 to Telegram
  }
});
