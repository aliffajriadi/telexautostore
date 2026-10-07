import { prisma } from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { generateToken } from '../../lib/crypto.js';
import { fetchProducts } from '../autostore/autostore-client.js';
import { botManager } from '../bot/bot-manager.js';
import { logger } from '../../lib/logger.js';
import axios from 'axios';
import type { Integration } from '@prisma/client';

export async function getDecryptedIntegration(integration: Integration) {
  return {
    ...integration,
    botToken: decrypt(integration.botTokenEnc),
    apiKey: decrypt(integration.apiKeyEnc),
    webhookSecret: decrypt(integration.webhookSecretEnc),
  };
}

export async function validateBotToken(token: string): Promise<string> {
  const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10_000 });
  if (!res.data.ok) throw new Error('Token bot tidak valid.');
  return res.data.result.username as string;
}

export async function validateAutoStoreConnection(baseUrl: string, apiKey: string): Promise<void> {
  try {
    await fetchProducts({ baseUrl, apiKey });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Koneksi ke AutoStore gagal: ${msg}`);
  }
}

export async function createOrUpdateIntegration(
  userId: number,
  data: {
    botToken?: string;
    autostoreUrl?: string;
    apiKey?: string;
    startMessage?: string;
    startImageUrl?: string;
  },
  existingIntegration?: Integration | null,
): Promise<Integration> {
  const updateData: Record<string, unknown> = {};

  if (data.botToken) {
    const botUsername = await validateBotToken(data.botToken);
    updateData.botTokenEnc = encrypt(data.botToken);
    updateData.botUsername = botUsername;
  }

  if (data.autostoreUrl) {
    updateData.autostoreUrl = data.autostoreUrl;
  }

  if (data.apiKey !== undefined) {
    updateData.apiKeyEnc = encrypt(data.apiKey);
  }

  if (data.startMessage !== undefined) {
    updateData.startMessage = data.startMessage || null;
  }

  if (data.startImageUrl !== undefined) {
    updateData.startImageUrl = data.startImageUrl || null;
  }

  if (existingIntegration) {
    const updated = await prisma.integration.update({
      where: { userId },
      data: updateData,
    });

    // A new token means a different bot: move the webhook over so the active bot keeps working
    if (data.botToken && existingIntegration.botActive) {
      const oldToken = decrypt(existingIntegration.botTokenEnc);
      if (oldToken !== data.botToken) {
        await botManager.deactivateBot(existingIntegration.botKey, oldToken);
        try {
          await botManager.activateBot(updated, data.botToken);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await prisma.integration.update({
            where: { id: updated.id },
            data: { botActive: false, lastError: message },
          });
          throw new Error(`Token tersimpan, tetapi bot gagal diaktifkan: ${message}`);
        }
      }
    }
    return updated;
  }

  // New integration: generate keys
  const botKey = generateToken(32);
  const callbackKey = generateToken(32);
  const webhookSecret = generateToken(24); // 48-char hex, > 16 chars
  const telegramSecret = generateToken(32);

  if (!data.botToken || !data.autostoreUrl) {
    throw new Error('Token bot dan URL AutoStore wajib diisi untuk integrasi baru.');
  }

  const botUsername = await validateBotToken(data.botToken);

  return prisma.integration.create({
    data: {
      userId,
      botKey,
      botTokenEnc: encrypt(data.botToken),
      botUsername,
      telegramSecret,
      autostoreUrl: data.autostoreUrl,
      apiKeyEnc: encrypt(data.apiKey ?? ''),
      callbackKey,
      webhookSecretEnc: encrypt(webhookSecret),
      botActive: false,
      startImageUrl: data.startImageUrl || null,
      startMessage: data.startMessage || null,
    },
  });
}

export async function regenerateCallbackKey(integrationId: number): Promise<Integration> {
  const newCallbackKey = generateToken(32);
  const newWebhookSecret = generateToken(24);
  return prisma.integration.update({
    where: { id: integrationId },
    data: {
      callbackKey: newCallbackKey,
      webhookSecretEnc: encrypt(newWebhookSecret),
    },
  });
}

export async function toggleBot(integration: Integration, activate: boolean): Promise<Integration> {
  if (activate) {
    // Register webhook
    const decrypted = await getDecryptedIntegration(integration);
    await botManager.activateBot(integration, decrypted.botToken);
  } else {
    await botManager.deactivateBot(integration.botKey, decrypt(integration.botTokenEnc));
  }
  return prisma.integration.update({
    where: { id: integration.id },
    data: { botActive: activate, lastError: activate ? null : undefined },
  });
}

export async function deactivateOnBlacklist(integration: Integration): Promise<void> {
  try {
    await botManager.deactivateBot(integration.botKey, decrypt(integration.botTokenEnc));
    await prisma.integration.update({
      where: { id: integration.id },
      data: { botActive: false },
    });
  } catch (err) {
    logger.error({ err, integrationId: integration.id }, 'Failed to deactivate bot on blacklist');
  }
}
