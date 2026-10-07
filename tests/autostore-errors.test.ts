import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AxiosError } from 'axios';

const { createQrisOrder, AutoStoreError } = await import('../src/modules/autostore/autostore-client.js');
const { errSerializer } = await import('../src/lib/logger.js');

const API_KEY = 'sk_live_supersecret_key';
const WEBHOOK_SECRET = 'whsec_supersecret_value_123';

async function withServer(status: number, body: unknown, fn: (url: string) => Promise<void>) {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const payload = { productId: 1, qty: 1, externalReference: 'tg-1', webhookUrl: 'https://x/y', webhookSecret: WEBHOOK_SECRET };

test('AutoStore 400 surfaces its message without leaking secrets', async () => {
  await withServer(400, { success: false, message: 'webhookUrl must be HTTPS' }, async (url) => {
    await assert.rejects(createQrisOrder({ baseUrl: url, apiKey: API_KEY }, payload), (err: unknown) => {
      assert.ok(err instanceof AutoStoreError);
      assert.equal(err.status, 400);
      assert.match(err.message, /webhookUrl must be HTTPS/);
      const logged = JSON.stringify(errSerializer(err));
      assert.ok(!logged.includes(API_KEY), 'API key leaked');
      assert.ok(!logged.includes(WEBHOOK_SECRET), 'webhook secret leaked');
      return true;
    });
  });
});

test('errSerializer strips axios config/request from raw axios errors', () => {
  const err = new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST',
    { headers: { 'X-Api-Key': API_KEY }, url: 'https://api.telegram.org/bot123:TOKEN/getMe', data: WEBHOOK_SECRET } as never,
    {},
    { status: 401, data: { description: 'Unauthorized' } } as never);
  const logged = JSON.stringify(errSerializer(err));
  assert.ok(!logged.includes(API_KEY));
  assert.ok(!logged.includes('123:TOKEN'));
  assert.ok(!logged.includes(WEBHOOK_SECRET));
  assert.match(logged, /Unauthorized/);
  assert.match(logged, /"status":401/);
});
