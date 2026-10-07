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

// TODO: Update these types once you get a real response example from AutoStore
export interface AutoStoreQrisOrderResponse {
  invoiceCode: string;
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

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const isNetworkError = err instanceof AxiosError && !err.response;
      if (!isNetworkError || attempt === maxRetries) throw err;
      const delay = attempt * 1500;
      logger.warn({ attempt, delay }, 'AutoStore request failed, retrying...');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export async function fetchProducts(options: AutoStoreClientOptions): Promise<AutoStoreProduct[]> {
  const client = buildClient(options);
  const response = await withRetry(() => client.get<{ success: boolean; products: AutoStoreProduct[] }>('/api/v1/integration/products'));
  const all = response.data.products || [];
  // Only show products with rupiah currency mode
  return all.filter((p) => p.currencyMode?.toLowerCase().includes('rupiah') || p.priceRupiah > 0);
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
