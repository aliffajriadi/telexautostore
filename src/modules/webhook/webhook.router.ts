import type { Router } from 'express';
import { Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { verifyStoreSignature, decrypt } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { closeInvoiceMessage, deliverOrder, notifyManualPending } from '../orders/delivery.service.js';

export const webhookRouter: Router = ExpressRouter();

// Raw body is attached by express via verify option in server.ts
declare module 'express' {
  interface Request {
    rawBody?: Buffer;
  }
}

const callbackSchema = z.object({
  invoiceCode: z.string().max(64).optional(),
  externalReference: z.string().max(64),
  order: z.object({
    orderCode: z.string().max(64).optional(),
    status: z.string(),
    deliveredItems: z.unknown().optional(),
  }),
  paidAt: z.string().optional(),
});

function parsePaidAt(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

webhookRouter.post('/:callbackKey', async (req: Request, res: Response) => {
  const callbackKey = req.params.callbackKey as string;

  // 1. Find integration by callbackKey
  const integration = await prisma.integration.findUnique({ where: { callbackKey } });
  if (!integration) {
    logger.warn('[WEBHOOK] Unknown callbackKey');
    res.status(404).end();
    return;
  }
  const log = logger.child({ integrationId: integration.id, userId: integration.userId });

  // 2. Get raw body
  const rawBody = req.rawBody;
  if (!rawBody) {
    log.warn('[WEBHOOK] No raw body received');
    res.status(400).end();
    return;
  }

  // 3. Verify HMAC signature (timing-safe)
  const webhookSecret = decrypt(integration.webhookSecretEnc);
  if (!verifyStoreSignature(rawBody, req.get('x-store-signature'), webhookSecret)) {
    log.warn('[WEBHOOK] Signature rejected');
    await prisma.integrationEvent
      .create({ data: { integrationId: integration.id, type: 'WEBHOOK_REJECTED', message: 'Callback ditolak: signature tidak valid.' } })
      .catch(() => {});
    res.status(401).end();
    return;
  }

  // 4. Parse body
  let payload: z.infer<typeof callbackSchema>;
  try {
    const parsed = callbackSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
    if (!parsed.success) throw new Error('invalid shape');
    payload = parsed.data;
  } catch {
    log.warn('[WEBHOOK] Invalid JSON body');
    res.status(400).end();
    return;
  }

  try {
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastCallbackAt: new Date() },
    });

    // Scope the lookup to this integration so one tenant can't touch another's orders
    const order = await prisma.order.findFirst({
      where: { externalReference: payload.externalReference, integrationId: integration.id },
    });
    if (!order) {
      log.warn({ externalReference: payload.externalReference }, '[WEBHOOK] Order not found, ignoring');
      res.status(200).json({ ok: true });
      return;
    }
    const orderLog = log.child({ orderId: order.id });
    const paidAt = parsePaidAt(payload.paidAt);

    if (payload.order.status === 'success') {
      // 5. Idempotency: atomically claim the transition so concurrent/duplicate
      // callbacks can't both deliver.
      const claimed = await prisma.order.updateMany({
        where: { id: order.id, status: { notIn: ['PAID', 'DELIVERED'] } },
        data: {
          status: 'PAID',
          invoiceCode: payload.invoiceCode ?? order.invoiceCode,
          orderCode: payload.order.orderCode ?? order.orderCode,
          deliveredItems: (payload.order.deliveredItems ?? null) as object,
          paidAt,
        },
      });
      res.status(200).json({ ok: true });
      if (claimed.count === 0) {
        orderLog.info('[WEBHOOK] Duplicate success callback ignored');
        return;
      }
      orderLog.info('[WEBHOOK] Order paid');

      // 6. Deliver in background (with retry inside)
      const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      setImmediate(async () => {
        try {
          await closeInvoiceMessage(integration, paidOrder, 'paid');
          await deliverOrder(integration, paidOrder);
        } catch (err) {
          orderLog.error({ err }, 'Unexpected delivery error');
        }
      });
      return;
    }

    if (payload.order.status === 'pending') {
      const claimed = await prisma.order.updateMany({
        where: { id: order.id, status: { notIn: ['PAID', 'DELIVERED', 'PAID_MANUAL_PENDING'] } },
        data: {
          status: 'PAID_MANUAL_PENDING',
          invoiceCode: payload.invoiceCode ?? order.invoiceCode,
          paidAt,
        },
      });
      res.status(200).json({ ok: true });
      if (claimed.count === 0) {
        orderLog.info('[WEBHOOK] Duplicate pending callback ignored');
        return;
      }
      orderLog.info('[WEBHOOK] Order paid, awaiting manual processing');

      const pendingOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      setImmediate(async () => {
        try {
          await closeInvoiceMessage(integration, pendingOrder, 'paid');
          await notifyManualPending(integration, pendingOrder);
        } catch (err) {
          orderLog.error({ err }, 'Unexpected notify error');
        }
      });
      return;
    }

    orderLog.warn({ status: payload.order.status }, '[WEBHOOK] Unknown order status, ignoring');
    res.status(200).json({ ok: true });
  } catch (err) {
    log.error({ err }, '[WEBHOOK] Error processing callback');
    await prisma.integrationEvent
      .create({
        data: {
          integrationId: integration.id,
          type: 'WEBHOOK_ERROR',
          message: `Gagal memproses callback ${payload.externalReference}: ${err instanceof Error ? err.message : String(err)}`,
        },
      })
      .catch(() => {});
    // 500 so AutoStore retries; the status claim above keeps retries idempotent
    if (!res.headersSent) res.status(500).end();
  }
});
