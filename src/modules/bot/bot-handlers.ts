import type { Bot, Context, InlineKeyboard } from 'grammy';
import { InlineKeyboard as IK } from 'grammy';
import type { Integration } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { createHash } from 'node:crypto';
import { decrypt, generateToken } from '../../lib/crypto.js';
import { fetchProducts, createQrisOrder, AutoStoreError } from '../autostore/autostore-client.js';
import { invoiceClosedNotice } from '../orders/delivery.service.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import type { AutoStoreProduct } from '../autostore/autostore-client.js';

const MAX_PENDING_ORDERS = 3;
const PENDING_EXPIRY_MINUTES = 30;
// AutoStore rejects QRIS invoices below this total ("Total harga QRIS minimal Rp 500.")
const QRIS_MIN_AMOUNT = 500;

function minQtyFor(product: AutoStoreProduct): number {
  return Math.max(1, Math.ceil(QRIS_MIN_AMOUNT / product.priceRupiah));
}
const CATALOG_CACHE = new Map<number, { products: AutoStoreProduct[]; fetchedAt: number }>();
const CATALOG_TTL_MS = 45_000; // 45 seconds
function escapeMd(text: string | number): string {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// Telegram limits callback_data to 64 bytes, so categories are referenced by a short hash
function catKey(category: string): string {
  return createHash('sha256').update(category).digest('hex').slice(0, 16);
}

function cancelKeyboard(orderId: number): InlineKeyboard {
  return new IK().text('❌ Batalkan Pembayaran', `cancel_order:${orderId}`);
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

async function getCachedProducts(integration: Integration): Promise<AutoStoreProduct[]> {
  const cached = CATALOG_CACHE.get(integration.id);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
    return cached.products;
  }
  const apiKey = decrypt(integration.apiKeyEnc);
  const products = await fetchProducts({ baseUrl: integration.autostoreUrl, apiKey });
  CATALOG_CACHE.set(integration.id, { products, fetchedAt: Date.now() });
  return products;
}

async function getOrCreateBuyer(ctx: Context, integrationId: number) {
  const from = ctx.from!;
  return prisma.buyer.upsert({
    where: { integrationId_telegramId: { integrationId, telegramId: BigInt(from.id) } },
    create: {
      integrationId,
      telegramId: BigInt(from.id),
      username: from.username,
      firstName: from.first_name,
    },
    update: { username: from.username, firstName: from.first_name },
  });
}

export function setupBotHandlers(bot: Bot, initialIntegration: Integration): void {
  let integration = initialIntegration;

  // Reload the integration on every update so dashboard changes (API key, URL,
  // start message) apply immediately, and stop serving buyers once the bot is
  // deactivated or its owner is blacklisted.
  bot.use(async (ctx, next) => {
    const fresh = await prisma.integration.findUnique({
      where: { id: initialIntegration.id },
      include: { user: { select: { status: true } } },
    });
    if (!fresh || !fresh.botActive || fresh.user.status !== 'ACTIVE') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    const { user: _user, ...rest } = fresh;
    integration = rest;
    await next();
  });

  // Helpers for main menu actions
  async function handleKatalog(ctx: Context, edit = false) {
    try {
      const products = await getCachedProducts(integration);
      if (products.length === 0) {
        await ctx.reply('😕 Tidak ada produk yang tersedia saat ini.');
        return;
      }

      const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];
      if (categories.length === 0) {
        await ctx.reply('😕 Belum ada kategori yang tersedia.');
        return;
      }

      const keyboard = new IK();
      for (const cat of categories) {
        keyboard.text(`📁 ${cat}`, `sel_cat:${catKey(cat)}`).row();
      }
      // Add back to main menu
      keyboard.text('🏠 Menu Utama', 'menu_utama').row();

      // If edit is requested and possible
      if (edit && ctx.callbackQuery) {
        await ctx.editMessageText('🛒 *Katalog Produk*\n\nPilih kategori produk:', {
          parse_mode: 'MarkdownV2',
          reply_markup: keyboard,
        });
      } else {
        await ctx.reply('🛒 *Katalog Produk*\n\nPilih kategori produk:', {
          parse_mode: 'MarkdownV2',
          reply_markup: keyboard,
        });
      }
    } catch (err) {
      logger.error({ err, integrationId: integration.id }, 'Error fetching catalog');
      if (edit && ctx.callbackQuery) {
        await ctx.editMessageText('⚠️ Gagal memuat katalog. Silakan coba lagi.');
      } else {
        await ctx.reply('⚠️ Gagal memuat katalog. Silakan coba lagi.');
      }
    }
  }

  async function handleRiwayat(ctx: Context) {
    try {
      const buyer = await getOrCreateBuyer(ctx, integration.id);
      const orders = await prisma.order.findMany({
        where: { buyerId: buyer.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      if (orders.length === 0) {
        await ctx.reply('📋 Kamu belum memiliki pesanan.');
        return;
      }

      const lines = orders.map((o) =>
        `• *${escapeMd(o.invoiceCode ?? o.externalReference)}* \\- ${escapeMd(o.productName)} x${o.qty} \\- ${escapeMd(formatRupiah(o.amount))} \\- _${escapeMd(o.status)}_`,
      );
      await ctx.reply('📋 *5 Pesanan Terakhir*\n\n' + lines.join('\n'), {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      logger.error({ err }, 'Error fetching order history');
      await ctx.reply('⚠️ Gagal memuat riwayat.');
    }
  }

  async function handleBantuan(ctx: Context) {
    await ctx.reply(
      '📖 *Bantuan*\n\n' +
        '/katalog \\- Lihat dan beli produk\n' +
        '/riwayat \\- Lihat 5 pesanan terakhir\n' +
        '/cek \\<kode\\> \\- Cek status pesanan\n' +
        '/bantuan \\- Tampilkan pesan ini',
      { parse_mode: 'MarkdownV2' },
    );
  }

  async function renderStartMenu(ctx: Context, isCallback = false) {
    const name = ctx.from?.first_name ?? 'Kamu';
    const keyboard = new IK()
      .text('🛍️ Katalog Produk', 'menu_katalog').row()
      .text('📋 Riwayat Pesanan', 'menu_riwayat').row()
      .text('ℹ️ Bantuan', 'menu_bantuan');

    // Custom messages are shown literally (escaped); the default one uses MarkdownV2 formatting
    const caption = integration.startMessage
      ? escapeMd(integration.startMessage.replace(/{name}/g, name))
      : `👋 Halo, ${escapeMd(name)}\\!\n\nSelamat datang di *AutoStore*\\. Silakan pilih menu di bawah ini untuk memulai berbelanja:`;
    const brandingUrl = integration.startImageUrl || 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=800&q=80';

    if (isCallback) {
      await ctx.deleteMessage().catch(() => {});
    }

    try {
      await ctx.replyWithPhoto(brandingUrl, {
        caption,
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
      });
    } catch (err) {
      // If photo fails (e.g. invalid URL), fallback to text
      await ctx.reply(caption, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
      });
    }
  }

  // /start
  bot.command('start', async (ctx) => {
    await renderStartMenu(ctx, false);
  });

  bot.callbackQuery('menu_utama', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderStartMenu(ctx, true);
  });

  bot.callbackQuery('menu_katalog', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await handleKatalog(ctx, false);
  });

  bot.callbackQuery('menu_riwayat', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await handleRiwayat(ctx);
  });

  bot.callbackQuery('menu_bantuan', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await handleBantuan(ctx);
  });

  // /katalog
  bot.command('katalog', (ctx) => handleKatalog(ctx, false));

  // /riwayat
  bot.command('riwayat', (ctx) => handleRiwayat(ctx));

  // /bantuan
  bot.command('bantuan', (ctx) => handleBantuan(ctx));

  // /cek <kode>
  bot.command('cek', async (ctx) => {
    const kode = ctx.match?.trim();
    if (!kode) {
      await ctx.reply('Penggunaan: /cek <kode_invoice>');
      return;
    }
    try {
      const order = await prisma.order.findFirst({
        where: {
          integrationId: integration.id,
          OR: [{ invoiceCode: kode }, { externalReference: kode }, { orderCode: kode }],
        },
      });
      if (!order) {
        await ctx.reply('❌ Pesanan tidak ditemukan.');
        return;
      }
      await ctx.reply(
        `📦 *Detail Pesanan*\n\nKode: \`${escapeMd(order.invoiceCode ?? order.externalReference)}\`\nProduk: ${escapeMd(order.productName)}\nJumlah: ${order.qty}\nTotal: ${escapeMd(formatRupiah(order.amount))}\nStatus: *${escapeMd(order.status)}*`,
        { parse_mode: 'MarkdownV2' },
      );
    } catch (err) {
      logger.error({ err }, 'Error checking order');
      await ctx.reply('⚠️ Gagal mengecek pesanan.');
    }
  });

  // Callback: category selected
  bot.callbackQuery(/^sel_cat:([0-9a-f]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1];
    try {
      const products = await getCachedProducts(integration);
      const catProducts = products.filter((p) => p.category && catKey(p.category) === key);
      const category = catProducts[0]?.category;

      if (!category) {
        await ctx.editMessageText('😕 Tidak ada produk di kategori ini.');
        return;
      }

      const keyboard = new IK();
      for (const p of catProducts) {
        const label =
          p.stockCount > 0
            ? `${p.name} – ${formatRupiah(p.priceRupiah)}`
            : `❌ ${p.name} (Stok habis)`;
        if (p.stockCount > 0) {
          keyboard.text(label, `select_product:${p.id}`).row();
        } else {
          keyboard.text(label, 'noop').row();
        }
      }
      keyboard.text('🔙 Kembali', 'back_katalog').row();

      // Escape markdown v2 reserved characters for category name
      const safeCategory = escapeMd(category);
      
      await ctx.editMessageText(`📂 *Kategori: ${safeCategory}*\n\nPilih produk:`, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error({ err, integrationId: integration.id }, 'Error loading category');
      await ctx.reply('⚠️ Gagal memuat produk kategori.');
    }
  });

  // Callback: back to categories
  bot.callbackQuery('back_katalog', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleKatalog(ctx, true);
  });

  async function renderQtyPicker(ctx: Context, product: AutoStoreProduct, currentQty: number) {
    const maxQty = product.stockCount;
    const minQty = minQtyFor(product);
    const qty = Math.max(minQty, Math.min(currentQty, maxQty));
    const total = product.priceRupiah * qty;

    const minus5 = Math.max(minQty, qty - 5);
    const minus1 = Math.max(minQty, qty - 1);
    const plus1 = Math.min(maxQty, qty + 1);
    const plus5 = Math.min(maxQty, qty + 5);

    const keyboard = new IK();
    keyboard.text('-5', `set_qty:${product.id}:${minus5}`)
            .text('-1', `set_qty:${product.id}:${minus1}`)
            .text(`🔢 ${qty}`, 'noop')
            .text('+1', `set_qty:${product.id}:${plus1}`)
            .text('+5', `set_qty:${product.id}:${plus5}`).row();

    keyboard.text('💳 Bayar', `confirm_buy:${product.id}:${qty}`).row();
    if (product.category) {
      keyboard.text('🔙 Kembali', `sel_cat:${catKey(product.category)}`).row();
    } else {
      keyboard.text('🔙 Kembali', `back_katalog`).row();
    }

    let text = `📦 *${escapeMd(product.name)}*\n\nHarga: ${escapeMd(formatRupiah(product.priceRupiah))}\nStok: ${product.stockCount}\n\n🛒 *Jumlah Pembelian: ${qty}*\n💰 *Total Harga: ${escapeMd(formatRupiah(total))}*`;
    if (minQty > 1) {
      text += `\n\nℹ️ _Minimal pembelian ${minQty} item \\(total pembayaran QRIS minimal ${escapeMd(formatRupiah(QRIS_MIN_AMOUNT))}\\)\\._`;
    }
    
    // We can use editMessageText because it was called from an inline keyboard callback
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  }

  // Callback: product selected
  bot.callbackQuery(/^select_product:(\d+)$/, async (ctx) => {
    const productId = parseInt(ctx.match[1]);
    const products = await getCachedProducts(integration);
    const product = products.find((p) => p.id === productId);

    if (!product || product.stockCount <= 0) {
      await ctx.answerCallbackQuery({ text: '😕 Produk tidak tersedia atau stok habis.', show_alert: true });
      return;
    }
    if (product.stockCount < minQtyFor(product)) {
      await ctx.answerCallbackQuery({
        text: `😕 Stok tidak cukup untuk pembelian minimal ${minQtyFor(product)} item (total minimal ${formatRupiah(QRIS_MIN_AMOUNT)}).`,
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();

    try {
      await renderQtyPicker(ctx, product, minQtyFor(product));
    } catch (err) {
      logger.error({ err }, 'Error rendering qty picker');
    }
  });

  // Callback: noop (disabled product or quantity display)
  bot.callbackQuery('noop', async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  // Callback: quantity selected
  // Callback: quantity adjusted
  bot.callbackQuery(/^set_qty:(\d+):(\d+)$/, async (ctx) => {
    const productId = parseInt(ctx.match[1]);
    const qty = parseInt(ctx.match[2]);

    const products = await getCachedProducts(integration);
    const product = products.find((p) => p.id === productId);

    if (!product || product.stockCount <= 0) {
      await ctx.answerCallbackQuery('😕 Produk tidak tersedia atau stok habis.');
      return;
    }

    try {
      await renderQtyPicker(ctx, product, qty);
      await ctx.answerCallbackQuery();
    } catch (err) {
      // Ignore "message is not modified" error which happens when clicking the same quantity button repeatedly
      await ctx.answerCallbackQuery();
    }
  });

  // Callback: confirm buy → create order + QRIS
  bot.callbackQuery(/^confirm_buy:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('⏳ Membuat invoice...');
    const productId = parseInt(ctx.match[1]);
    const qty = parseInt(ctx.match[2]);

    try {
      const buyer = await getOrCreateBuyer(ctx, integration.id);

      // Check pending order limit
      const pendingCount = await prisma.order.count({
        where: { buyerId: buyer.id, status: 'PENDING_PAYMENT' },
      });
      if (pendingCount >= MAX_PENDING_ORDERS) {
        await ctx.reply(
          `⚠️ Kamu memiliki ${pendingCount} pesanan yang belum dibayar. Selesaikan atau tunggu pesanan sebelumnya kadaluarsa dulu.`,
        );
        return;
      }

      // Live stock check
      const apiKey = decrypt(integration.apiKeyEnc);
      const products = await fetchProducts({ baseUrl: integration.autostoreUrl, apiKey });
      const product = products.find((p) => p.id === productId);
      if (!product || product.stockCount < qty) {
        await ctx.editMessageText('😕 Stok tidak mencukupi. Silakan kembali dan pilih jumlah lebih kecil.');
        return;
      }
      if (product.priceRupiah * qty < QRIS_MIN_AMOUNT) {
        await ctx.editMessageText(`😕 Total pembayaran QRIS minimal ${formatRupiah(QRIS_MIN_AMOUNT)}. Silakan tambah jumlah pembelian.`);
        return;
      }

      const amount = product.priceRupiah * qty;
      const expiresAt = new Date(Date.now() + PENDING_EXPIRY_MINUTES * 60 * 1000);

      // Create local order
      const order = await prisma.order.create({
        data: {
          integrationId: integration.id,
          buyerId: buyer.id,
          externalReference: `tmp-${generateToken(16)}`, // unique placeholder, replaced below
          productId,
          productName: product.name,
          qty,
          amount,
          status: 'PENDING_PAYMENT',
          expiresAt,
        },
      });

      // AutoStore dedups invoices by externalReference (per API key) and returns the
      // existing invoice for a repeated value. Order ids alone repeat across databases
      // (dev vs production, resets), so add a random suffix to keep it globally unique.
      // The same value is reused for retries inside createQrisOrder.
      const externalReference = `tg-${order.id}-${generateToken(6)}`;
      await prisma.order.update({ where: { id: order.id }, data: { externalReference } });

      const callbackUrl = `${env.APP_URL}/webhook/autostore/${integration.callbackKey}`;
      const webhookSecret = decrypt(integration.webhookSecretEnc);

      let qrisResp;
      try {
        qrisResp = await createQrisOrder(
          { baseUrl: integration.autostoreUrl, apiKey },
          { productId, qty, externalReference, webhookUrl: callbackUrl, webhookSecret },
        );
        // Guard against AutoStore handing back an old invoice (already paid/expired)
        if (qrisResp.status && qrisResp.status !== 'WAITING_PAYMENT') {
          throw new AutoStoreError(`AutoStore mengembalikan invoice lama berstatus ${qrisResp.status} (${qrisResp.invoiceCode}).`);
        }
      } catch (err) {
        // Don't leave it PENDING_PAYMENT: it would count toward the buyer's pending limit.
        // A late order.paid callback can still move a FAILED order to PAID.
        await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
        await prisma.integrationEvent.create({
          data: {
            integrationId: integration.id,
            type: 'AUTOSTORE_ERROR',
            message: `Gagal membuat invoice QRIS untuk order ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        throw err;
      }

      // Save invoiceCode
      await prisma.order.update({
        where: { id: order.id },
        data: {
          invoiceCode: qrisResp.invoiceCode,
          orderCode: qrisResp.orderCode,
          expiresAt: qrisResp.expiresAt ? new Date(qrisResp.expiresAt) : expiresAt,
        },
      });

      // Send QRIS to buyer
      const displayAmount = qrisResp.totalAmount || amount;
      let message = `💳 *Invoice Pembayaran*\n\nKode: \`${escapeMd(qrisResp.invoiceCode)}\`\nProduk: ${escapeMd(product.name)}\nJumlah: ${qty}\nTotal: *${escapeMd(formatRupiah(displayAmount))}*`;
      message += `\n\nScan QRIS di bawah dan bayar dengan dompet digital favorit mu\\.`;
      if (qrisResp.expiresAt) {
        const exp = escapeMd(new Date(qrisResp.expiresAt).toLocaleString('id-ID'));
        message += `\n\n⏰ Batas pembayaran: ${exp}`;
      }

      const invoiceKeyboard = cancelKeyboard(order.id);
      let invoiceMessageId: number | undefined;
      if (qrisResp.qrImageUrl) {
        // Replace the quantity picker with the QR photo
        await ctx.deleteMessage().catch(() => {});
        const sent = await ctx.replyWithPhoto(qrisResp.qrImageUrl, { caption: message, parse_mode: 'MarkdownV2', reply_markup: invoiceKeyboard });
        invoiceMessageId = sent.message_id;
      } else {
        if (qrisResp.paymentUrl) {
          // Fallback to sending the payment link if there's no image
          message += `\n\n🔗 [Bayar di sini](${qrisResp.paymentUrl})`;
        }
        await ctx.editMessageText(message, { parse_mode: 'MarkdownV2', link_preview_options: { is_disabled: true }, reply_markup: invoiceKeyboard });
        invoiceMessageId = ctx.callbackQuery.message?.message_id;
      }

      // Remember where the QR lives so it can be removed once the invoice closes
      if (invoiceMessageId && ctx.chat) {
        await prisma.order.update({
          where: { id: order.id },
          data: { invoiceChatId: BigInt(ctx.chat.id), invoiceMessageId },
        });
      }
    } catch (err) {
      logger.error({ err, integrationId: integration.id }, 'Error creating QRIS order');
      // AutoStore's 4xx messages are buyer-facing business rules (e.g. minimum amount), safe to show
      const reason =
        err instanceof AutoStoreError && err.status && err.status < 500 && err.responseBody
          ? `\n\nAlasan: ${err.responseBody}`
          : '';
      await ctx.editMessageText(`⚠️ Gagal membuat invoice.${reason}\n\nSilakan coba lagi dalam beberapa saat.`);
    }
  });

  // ─── Cancel payment ──────────────────────────────────────────────────────────
  // Step 1: ask for confirmation so a stray tap doesn't cancel the invoice
  bot.callbackQuery(/^cancel_order:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = ctx.match[1];
    await ctx
      .editMessageReplyMarkup({
        reply_markup: new IK()
          .text('✅ Ya, batalkan', `cancel_yes:${orderId}`)
          .text('↩️ Tidak', `cancel_no:${orderId}`),
      })
      .catch(() => {});
  });

  bot.callbackQuery(/^cancel_no:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: cancelKeyboard(Number(ctx.match[1])) }).catch(() => {});
  });

  // Opens the catalog in a new message, keeping the cancelled invoice visible
  bot.callbackQuery('shop_again', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleKatalog(ctx, false);
  });

  // Step 2: cancel, but only the buyer's own order that is still awaiting payment
  bot.callbackQuery(/^cancel_yes:(\d+)$/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    try {
      const buyer = await prisma.buyer.findUnique({
        where: { integrationId_telegramId: { integrationId: integration.id, telegramId: BigInt(ctx.from.id) } },
      });
      const result = buyer
        ? await prisma.order.updateMany({
            where: { id: orderId, integrationId: integration.id, buyerId: buyer.id, status: 'PENDING_PAYMENT' },
            data: { status: 'CANCELLED' },
          })
        : { count: 0 };

      if (result.count === 0) {
        const order = buyer
          ? await prisma.order.findFirst({ where: { id: orderId, integrationId: integration.id, buyerId: buyer.id } })
          : null;
        const reason =
          order && ['PAID', 'DELIVERED', 'PAID_MANUAL_PENDING'].includes(order.status)
            ? 'Pesanan ini sudah dibayar, tidak bisa dibatalkan.'
            : order?.status === 'EXPIRED'
              ? 'Invoice ini sudah kedaluwarsa.'
              : 'Pesanan ini sudah tidak aktif.';
        await ctx.answerCallbackQuery({ text: reason, show_alert: true });
        await ctx.editMessageReplyMarkup().catch(() => {});
        return;
      }

      logger.info({ orderId, integrationId: integration.id }, 'Order cancelled by buyer');
      await ctx.answerCallbackQuery('Pembayaran dibatalkan.');

      // Remove the QR so it can't be paid by mistake, then explain why it's gone
      const cancelled = await prisma.order.findUnique({ where: { id: orderId } });
      const code = cancelled?.invoiceCode ?? cancelled?.externalReference ?? `#${orderId}`;
      const deleted = await ctx.deleteMessage().then(() => true, () => false);
      if (!deleted) await ctx.editMessageReplyMarkup().catch(() => {});
      await ctx.reply(invoiceClosedNotice('cancelled', code), {
        reply_markup: new IK().text('🛍️ Belanja Lagi', 'shop_again'),
      });
    } catch (err) {
      logger.error({ err, orderId, integrationId: integration.id }, 'Error cancelling order');
      await ctx.answerCallbackQuery({ text: '⚠️ Gagal membatalkan. Coba lagi.', show_alert: true }).catch(() => {});
    }
  });

  // Error handler
  bot.catch((err) => {
    logger.error({ err: err.error, botKey: integration.botKey }, 'Bot error');
  });
}
