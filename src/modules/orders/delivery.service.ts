import { Api, InputFile, InlineKeyboard } from 'grammy';
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

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

async function recordEvent(integrationId: number, type: string, message: string): Promise<void> {
  await prisma.integrationEvent
    .create({ data: { integrationId, type, message } })
    .catch((err) => logger.error({ err, integrationId }, 'Failed to record integration event'));
}

// ─── Delivery message template ────────────────────────────────────────────────

export const DELIVERY_PLACEHOLDERS = ['{name}', '{product}', '{qty}', '{total}', '{invoice}'] as const;

export const DEFAULT_DELIVERY_MESSAGE =
  '✅ Pembayaran diterima!\n\n' +
  'Pesanan {product} x{qty} (invoice {invoice}) sudah selesai diproses. ' +
  'Silakan unduh file pesanan kamu di bawah ini.\n\n' +
  'Terima kasih sudah berbelanja!';

// Telegram caps document captions at 1024 characters
const CAPTION_LIMIT = 1024;

/** Fills the merchant's delivery template. Output is plain text (no parse mode). */
export function renderDeliveryMessage(
  template: string | null | undefined,
  vars: { name: string; product: string; qty: number; total: number; invoice: string },
): string {
  const text = (template?.trim() || DEFAULT_DELIVERY_MESSAGE)
    .replace(/{name}/g, vars.name)
    .replace(/{product}/g, vars.product)
    .replace(/{qty}/g, String(vars.qty))
    .replace(/{total}/g, formatRupiah(vars.total))
    .replace(/{invoice}/g, vars.invoice);
  return text.length > CAPTION_LIMIT ? `${text.slice(0, CAPTION_LIMIT - 1)}…` : text;
}

// ─── Invoice message lifecycle ────────────────────────────────────────────────

export type InvoiceCloseReason = 'paid' | 'expired' | 'cancelled';

export function invoiceClosedNotice(reason: InvoiceCloseReason, invoiceCode: string): string {
  switch (reason) {
    case 'expired':
      return `⏰ Invoice ${invoiceCode} sudah kedaluwarsa.\n\nQR pembayaran sudah tidak berlaku, JANGAN lakukan pembayaran. Silakan buat pesanan baru lewat /katalog.`;
    case 'cancelled':
      return `❌ Pembayaran dibatalkan.\n\nInvoice ${invoiceCode} sudah tidak berlaku, JANGAN lakukan pembayaran untuk QR tersebut.`;
    case 'paid':
      return `✅ Invoice ${invoiceCode} sudah lunas. QR pembayaran sudah tidak berlaku, jangan dibayar lagi.`;
  }
}

/**
 * Removes the QR message for a closed invoice so the buyer can't pay it again.
 * Falls back to stripping its buttons when Telegram refuses the delete
 * (e.g. message older than 48 hours). Returns true if the QR message is gone.
 */
async function removeInvoiceMessage(api: Api, order: Order): Promise<boolean> {
  if (!order.invoiceChatId || !order.invoiceMessageId) return false;
  const chatId = Number(order.invoiceChatId);
  try {
    await api.deleteMessage(chatId, order.invoiceMessageId);
    return true;
  } catch {
    await api.editMessageReplyMarkup(chatId, order.invoiceMessageId).catch(() => {});
    return false;
  }
}

/**
 * Closes the buyer's invoice message: deletes the QR and, for expired or
 * cancelled invoices, sends a notice telling the buyer not to pay.
 * Paid invoices get no separate notice — the delivery message follows.
 */
export async function closeInvoiceMessage(
  integration: Integration,
  order: Order,
  reason: InvoiceCloseReason,
): Promise<void> {
  if (!order.invoiceChatId || !order.invoiceMessageId) return;
  try {
    const api = apiFor(integration);
    const removed = await removeInvoiceMessage(api, order);
    if (reason === 'paid' && removed) return;

    const code = order.invoiceCode ?? order.externalReference;
    await withTelegramRetry(() =>
      api.sendMessage(Number(order.invoiceChatId), invoiceClosedNotice(reason, code), {
        reply_markup: reason === 'paid' ? undefined : new InlineKeyboard().text('🛍️ Belanja Lagi', 'shop_again'),
      }),
    );
  } catch (err) {
    logger.warn({ err, orderId: order.id, integrationId: integration.id, reason }, 'Failed to close invoice message');
  }
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

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

  const invoice = order.invoiceCode ?? order.externalReference;
  const fileName = `Pesanan_${invoice}.txt`;
  const buffer = Buffer.from(formatItems(order.deliveredItems), 'utf-8');
  const caption = renderDeliveryMessage(integration.deliveryMessage, {
    name: buyer.firstName ?? buyer.username ?? 'Kak',
    product: order.productName,
    qty: order.qty,
    total: order.amount,
    invoice,
  });

  try {
    const api = apiFor(integration);
    await withTelegramRetry(() =>
      api.sendDocument(Number(buyer.telegramId), new InputFile(buffer, fileName), { caption }),
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
  const code = order.invoiceCode ?? order.externalReference;

  try {
    const api = apiFor(integration);
    await withTelegramRetry(() =>
      api.sendMessage(
        Number(buyer.telegramId),
        `✅ Pembayaran kamu sudah diterima!\n\n⏳ Item sedang dalam proses verifikasi manual. Kami akan segera mengirimkannya. Gunakan /cek ${code} untuk cek status. Terima kasih atas kesabarannya!`,
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
