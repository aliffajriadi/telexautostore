import axios, { AxiosError } from 'axios';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { outboundAgents } from '../../lib/ssrf-guard.js';

export interface AutoStoreProduct {
  id: number;
  name: string;
  category: string;
  priceWl: number;
  priceRupiah: number;
  currencyMode: string;
  deliveryType: string;
  stockCount: number;
}

// Shape of `data` in a 201 response, confirmed against a real AutoStore invoice
export interface AutoStoreQrisOrderResponse {
  invoiceCode: string;
  externalReference?: string;
  status?: string; // "WAITING_PAYMENT" for a fresh invoice
  qrImageUrl?: string; // URL to QR image
  paymentUrl?: string; // URL to payment page
  paymentNumber?: string; // Raw QRIS string
  amount: number;
  totalAmount?: number;
  expiresAt?: string;  // ISO datetime, if provided by AutoStore
  orderCode?: string;
}

export interface AutoStoreCallbackPayload {
  invoiceCode: string;
  externalReference: string;
  order: {
    orderCode: string;
    status: 'success' | 'pending';
    productId: number;
    productName: string;
    qty: number;
    amount: number;
    currency: string;
    deliveredItems: unknown;
  };
  paidAt: string;
}

export interface AutoStoreClientOptions {
  baseUrl: string;
  apiKey: string;
}

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

function buildClient(options: AutoStoreClientOptions) {
  return axios.create({
    baseURL: options.baseUrl.replace(/\/$/, ''),
    timeout: TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength: MAX_RESPONSE_BYTES,
    maxRedirects: 0, // No redirect following
    ...outboundAgents, // re-checks resolved IPs on every request in production
    headers: {
      // TODO: confirm the header name with AutoStore docs; configurable via AUTOSTORE_API_KEY_HEADER
      ...(options.apiKey ? { [env.AUTOSTORE_API_KEY_HEADER]: options.apiKey } : {}),
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Error thrown for any failed AutoStore request. Carries only the HTTP status
 * and AutoStore's own error message — never the axios config, which holds the
 * API key header and the webhookSecret from the request body.
 */
export class AutoStoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = 'AutoStoreError';
  }
}

function describeBody(data: unknown): string | undefined {
  if (data == null || data === '') return undefined;
  if (typeof data === 'string') return data.slice(0, 500);
  const d = data as { message?: unknown; error?: unknown; errors?: unknown };
  const msg = d.message ?? d.error;
  if (typeof msg === 'string') {
    return d.errors ? `${msg} ${JSON.stringify(d.errors).slice(0, 400)}` : msg;
  }
  return JSON.stringify(data).slice(0, 500);
}

function toAutoStoreError(err: unknown): AutoStoreError {
  if (err instanceof AutoStoreError) return err;
  if (err instanceof AxiosError) {
    if (err.response) {
      const body = describeBody(err.response.data);
      return new AutoStoreError(
        `AutoStore membalas ${err.response.status}${body ? `: ${body}` : ''}`,
        err.response.status,
        body,
      );
    }
    return new AutoStoreError(`Tidak bisa menghubungi AutoStore (${err.code ?? err.message})`);
  }
  return new AutoStoreError(err instanceof Error ? err.message : String(err));
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isNetworkError = err instanceof AxiosError && !err.response;
      if (!isNetworkError || attempt >= maxRetries) throw toAutoStoreError(err);
      const delay = attempt * 1500;
      logger.warn({ attempt, delay }, 'AutoStore request failed, retrying...');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function fetchProducts(options: AutoStoreClientOptions): Promise<AutoStoreProduct[]> {
  const client = buildClient(options);
  const response = await withRetry(() => client.get<{ success: boolean; products: AutoStoreProduct[] }>('/api/v1/integration/products'));
  const all = response.data.products || [];
  // Only products payable in rupiah. AutoStore uses currencyMode "both", "rp_only" or "wl_only".
  return all.filter((p) => {
    const mode = p.currencyMode?.toLowerCase() ?? '';
    return mode !== 'wl_only' && (mode === 'both' || mode.startsWith('rp')) && p.priceRupiah > 0;
  });
}

export async function createQrisOrder(
  options: AutoStoreClientOptions,
  payload: {
    productId: number;
    qty: number;
    externalReference: string;
    webhookUrl: string;
    webhookSecret: string;
  },
): Promise<AutoStoreQrisOrderResponse> {
  const client = buildClient(options);
  // Use the same externalReference for retries (idempotency)
  const response = await withRetry(() =>
    client.post<any>('/api/v1/integration/orders/qris', payload),
  );
  const respData = response.data.data || response.data;
  return respData as AutoStoreQrisOrderResponse;
}
