import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { deliverOrder } from '../modules/orders/delivery.service.js';

/**
 * Job: expire PENDING_PAYMENT orders that have passed their expiresAt time.
 * Runs every 5 minutes.
 */
export function startOrderExpiryJob(): void {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const result = await prisma.order.updateMany({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      if (result.count > 0) {
        logger.info({ count: result.count }, 'Expired pending orders');
      }
    } catch (err) {
      logger.error({ err }, 'Error in order expiry job');
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
