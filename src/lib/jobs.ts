import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { closeInvoiceMessage, deliverOrder } from '../modules/orders/delivery.service.js';

/**
 * Job: expire PENDING_PAYMENT orders that have passed their expiresAt time,
 * then remove the buyer's QR message and tell them not to pay it.
 * Runs every minute so the QR disappears soon after expiry.
 */
export function startOrderExpiryJob(): void {
  let running = false;
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const due = await prisma.order.findMany({
        where: { status: 'PENDING_PAYMENT', expiresAt: { lte: new Date() } },
        include: { integration: true },
        take: 200,
      });
      let expired = 0;
      for (const { integration, ...order } of due) {
        // Claim atomically: a payment callback may have arrived in the meantime
        const claimed = await prisma.order.updateMany({
          where: { id: order.id, status: 'PENDING_PAYMENT' },
          data: { status: 'EXPIRED' },
        });
        if (claimed.count === 0) continue;
        expired++;
        await closeInvoiceMessage(integration, order, 'expired');
      }
      if (expired > 0) {
        logger.info({ count: expired }, 'Expired pending orders');
      }
    } catch (err) {
      logger.error({ err }, 'Error in order expiry job');
    } finally {
      running = false;
    }
  });

  logger.info('Order expiry cron started');
}

/**
 * Job: clean up expired sessions from DB.
 * Runs every hour.
 */
export function startSessionCleanupJob(): void {
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await prisma.session.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      if (result.count > 0) {
        logger.debug({ count: result.count }, 'Cleaned up expired sessions');
      }
    } catch (err) {
      logger.error({ err }, 'Error in session cleanup job');
    }
  });
}

/**
 * Job: retry delivery of orders that were paid but whose items never reached
 * the buyer (e.g. Telegram was down). Runs every 5 minutes, only for orders
 * paid in the last 24 hours, and skips very recent ones that may still be in
 * the webhook's own background delivery.
 */
export function startDeliveryRetryJob(): void {
  let running = false;
  cron.schedule('*/5 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const orders = await prisma.order.findMany({
        where: {
          status: 'PAID',
          paidAt: { gte: new Date(now - 24 * 60 * 60 * 1000) },
          updatedAt: { lte: new Date(now - 2 * 60 * 1000) },
        },
        include: { integration: true },
        take: 50,
      });
      for (const { integration, ...order } of orders) {
        await deliverOrder(integration, order);
      }
      if (orders.length > 0) {
        logger.info({ count: orders.length }, 'Retried undelivered paid orders');
      }
    } catch (err) {
      logger.error({ err }, 'Error in delivery retry job');
    } finally {
      running = false;
    }
  });
}
