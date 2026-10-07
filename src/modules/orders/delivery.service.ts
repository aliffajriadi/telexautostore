import { Api, InputFile } from 'grammy';
import type { Integration, Order } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';

/**
 * Builds a Telegram API client straight from the stored token.
 * Deliberately independent of BotManager: buyers who already paid must get
 * their items even if the bot is deactivated, the owner is blacklisted, or the
 * bot instance isn't loaded in memory.
 */
function apiFor(integration: Integration): Api {
  return new Api(decrypt(integration.botTokenEnc));
}

export async function withTelegramRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      // Handle Telegram 429 rate limit
      const retryAfter = (err as { parameters?: { retry_after?: number } })?.parameters?.retry_after;
      const delay = retryAfter ? retryAfter * 1000 : attempt * 2000;
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function formatItems(items: unknown): string {
  if (Array.isArray(items)) {
    return items.map((i) => (typeof i === 'string' ? i : JSON.stringify(i))).join('\n');
  }
  if (typeof items === 'string') return items;
  return JSON.stringify(items, null, 2);
}

async function recordEvent(integrationId: number, type: string, message: string): Promise<void> {
  await prisma.integrationEvent
    .create({ data: { integrationId, type, message } })
    .catch((err) => logger.error({ err, integrationId }, 'Failed to record integration event'));
}

/**
 * Sends the order's deliveredItems to the buyer and marks it DELIVERED.
 * Only marks DELIVERED after Telegram accepted the message; on failure the
 * order stays PAID and a DELIVERY_FAILED event is recorded.
 */
export async function deliverOrder(integration: Integration, order: Order): Promise<boolean> {
  const buyer = await prisma.buyer.findUnique({ where: { id: order.buyerId } });
  if (!buyer) {
    await recordEvent(integration.id, 'DELIVERY_FAILED', `Pembeli untuk order ${order.id} tidak ditemukan.`);
    return false;
  }

  const fileName = `Pesanan_${order.invoiceCode ?? order.externalReference}.txt`;
  const buffer = Buffer.from(formatItems(order.deliveredItems), 'utf-8');

  try {
    const api = apiFor(integration);
    await withTelegramRetry(() =>
      api.sendDocument(Number(buyer.telegramId), new InputFile(buffer, fileName), {
        caption: `✅ *Pembayaran Diterima\\!*\n\nPesanan kamu sudah selesai diproses\\. Silakan unduh file pesanan kamu di bawah ini\\.\n\nTerima kasih sudah berbelanja\\!`,
        parse_mode: 'MarkdownV2',
      }),
    );
  } catch (err) {
    logger.error({ err, orderId: order.id, integrationId: integration.id }, 'Failed to deliver order items');
    await recordEvent(
      integration.id,
      'DELIVERY_FAILED',
      `Gagal mengirim item order ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'DELIVERED', deliveredAt: new Date() },
  });
  logger.info({ orderId: order.id, integrationId: integration.id }, 'Order delivered');
  return true;
}

/** Tells the buyer that payment arrived but items need manual processing. */
export async function notifyManualPending(integration: Integration, order: Order): Promise<void> {
  const buyer = await prisma.buyer.findUnique({ where: { id: order.buyerId } });
  if (!buyer) return;
  const code = (order.invoiceCode ?? order.externalReference).replace(/[`\\]/g, '\\$&');

  try {
    const api = apiFor(integration);
    await withTelegramRetry(() =>
      api.sendMessage(
        Number(buyer.telegramId),
        `✅ Pembayaran kamu sudah diterima\\!\n\n⏳ Item sedang dalam proses verifikasi manual\\. Kami akan segera mengirimkannya\\. Gunakan /cek \`${code}\` untuk cek status\\. Terima kasih atas kesabarannya\\!`,
        { parse_mode: 'MarkdownV2' },
      ),
    );
  } catch (err) {
    logger.error({ err, orderId: order.id, integrationId: integration.id }, 'Failed to notify buyer (manual pending)');
    await recordEvent(
      integration.id,
      'DELIVERY_FAILED',
      `Gagal memberi tahu pembeli order ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
