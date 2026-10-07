import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { encrypt, decrypt, verifyStoreSignature } = await import('../src/lib/crypto.js');

test('encrypt/decrypt round-trips and never stores plaintext', () => {
  const secret = '123456:ABC-bot-token';
  const enc = encrypt(secret);
  assert.notEqual(enc, secret);
  assert.ok(!Buffer.from(enc, 'base64').toString('latin1').includes(secret));
  assert.equal(decrypt(enc), secret);
});

test('encrypt uses a fresh IV each time', () => {
  assert.notEqual(encrypt('same'), encrypt('same'));
});

test('decrypt rejects tampered ciphertext', () => {
  const buf = Buffer.from(encrypt('hello'), 'base64');
  buf[buf.length - 1] ^= 0xff;
  assert.throws(() => decrypt(buf.toString('base64')));
});

const body = Buffer.from('{"externalReference":"tg-1","order":{"status":"success"}}');
const secret = 'webhook-secret-0123456789';
const sign = (b: Buffer, s: string) => 'sha256=' + createHmac('sha256', s).update(b).digest('hex');

test('verifyStoreSignature accepts a valid signature', () => {
  assert.equal(verifyStoreSignature(body, sign(body, secret), secret), true);
});

test('verifyStoreSignature rejects wrong secret, modified body, bad format', () => {
  assert.equal(verifyStoreSignature(body, sign(body, 'other-secret'), secret), false);
  assert.equal(verifyStoreSignature(Buffer.concat([body, Buffer.from(' ')]), sign(body, secret), secret), false);
  assert.equal(verifyStoreSignature(body, sign(body, secret).slice(7), secret), false);
  assert.equal(verifyStoreSignature(body, undefined, secret), false);
  assert.equal(verifyStoreSignature(body, 'sha256=zz', secret), false);
});
