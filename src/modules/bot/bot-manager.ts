import { Bot, webhookCallback } from 'grammy';
import type { Integration } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { setupBotHandlers } from './bot-handlers.js';
import type { Request, Response } from 'express';
import axios from 'axios';

interface BotEntry {
  bot: Bot;
  handleUpdate: (req: Request, res: Response) => Promise<void>;
}

class BotManager {
  private bots = new Map<string, BotEntry>();

  private async createBotInstance(integration: Integration, botToken: string): Promise<BotEntry> {
    const bot = new Bot(botToken);
    setupBotHandlers(bot, integration);
    const handleUpdate = webhookCallback(bot, 'express', {
      secretToken: integration.telegramSecret,
    });
    return { bot, handleUpdate };
  }

  async activateBot(integration: Integration, botToken: string): Promise<void> {
    const { botKey, telegramSecret } = integration;
    const webhookUrl = `${env.APP_URL}/telegram/${botKey}`;

    try {
      await axios.post(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          url: webhookUrl,
          secret_token: telegramSecret,
          allowed_updates: ['message', 'callback_query'],
        },
        { timeout: 10_000 },
      );

      // Set bot commands menu
      await axios.post(
        `https://api.telegram.org/bot${botToken}/setMyCommands`,
        {
          commands: [
            { command: 'start', description: 'Mulai bot / Menu utama' },
            { command: 'katalog', description: 'Lihat daftar produk' },
            { command: 'riwayat', description: 'Riwayat pesanan kamu' },
            { command: 'bantuan', description: 'Pusat bantuan' },
          ],
        },
        { timeout: 10_000 },
      );
    } catch (err: any) {
      const tgError = err.response?.data?.description;
      if (tgError) {
        throw new Error(`Telegram error: ${tgError}`);
      }
      throw err;
    }

    const entry = await this.createBotInstance(integration, botToken);
    this.bots.set(botKey, entry);
    logger.info({ botKey, webhookUrl }, 'Bot activated');
  }

  async deactivateBot(botKey: string, botToken: string): Promise<void> {
    // Remove webhook from Telegram
    try {
      await axios.post(
        `https://api.telegram.org/bot${botToken}/deleteWebhook`,
        {},
        { timeout: 10_000 },
      );
    } catch (err) {
      logger.warn({ err, botKey }, 'Failed to delete webhook from Telegram');
    }
    this.bots.delete(botKey);
    logger.info({ botKey }, 'Bot deactivated');
  }

  getHandler(botKey: string): BotEntry | undefined {
    return this.bots.get(botKey);
  }

  isActive(botKey: string): boolean {
    return this.bots.has(botKey);
  }

  /**
   * Reload all active bots from DB on server startup.
   * Called from server.ts after DB is ready.
   */
  async resyncAll(
    integrations: Array<{ integration: Integration; botToken: string }>,
  ): Promise<void> {
    for (const { integration, botToken } of integrations) {
      try {
        const entry = await this.createBotInstance(integration, botToken);
        this.bots.set(integration.botKey, entry);
        logger.info({ botKey: integration.botKey }, 'Bot re-synced on startup');
      } catch (err) {
        logger.error({ err, botKey: integration.botKey }, 'Failed to re-sync bot');
      }
    }
  }
}

export const botManager = new BotManager();
