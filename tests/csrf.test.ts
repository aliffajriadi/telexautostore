import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';

const { csrfProtection, CSRF_COOKIE } = await import('../src/lib/csrf.js');

const TOKEN = 'a'.repeat(64);

function run(method: string, cookie?: string, header?: string) {
  const result = { status: 200, nextCalled: false, cookieSet: false };
  const req = {
    method,
    cookies: cookie ? { [CSRF_COOKIE]: cookie } : {},
    get: (name: string) => (name.toLowerCase() === 'x-xsrf-token' ? header : undefined),
  } as unknown as Request;
  const res = {
    cookie: () => { result.cookieSet = true; return res; },
    status: (s: number) => { result.status = s; return res; },
    json: () => res,
  } as unknown as Response;
  csrfProtection(req, res, () => { result.nextCalled = true; });
  return result;
}

test('GET without cookie issues a token and passes', () => {
  const r = run('GET');
  assert.equal(r.cookieSet, true);
  assert.equal(r.nextCalled, true);
});

test('POST with matching header passes', () => {
  assert.equal(run('POST', TOKEN, TOKEN).nextCalled, true);
});

test('POST without or with wrong header is rejected', () => {
  for (const r of [run('POST', TOKEN), run('POST', TOKEN, 'b'.repeat(64)), run('POST', undefined, TOKEN)]) {
    assert.equal(r.nextCalled, false);
    assert.equal(r.status, 403);
  }
});
