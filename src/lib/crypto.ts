import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { env } from '../config/env.js';

function getKey(): Buffer {
  let key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    const raw = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
    key = Buffer.alloc(32);
    raw.copy(key, 0, 0, Math.min(raw.length, 32));
  }
  return key;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Stores iv + authTag + ciphertext as a single base64 string.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv[12] + authTag[16] + ciphertext)
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts a value encrypted with encrypt().
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  const combined = Buffer.from(encoded, 'base64');
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(12, 28);
  const ciphertext = combined.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Computes HMAC-SHA256 and returns hex string.
 */
export function hmacSha256(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Timing-safe comparison of two hex HMAC strings.
 */
export function safeCompareHmac(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Generates a random URL-safe token of given byte length.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Verifies an AutoStore `X-Store-Signature: sha256=<hex>` header against the raw body.
 */
export function verifyStoreSignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  return safeCompareHmac(header.slice(7), hmacSha256(secret, rawBody));
}
