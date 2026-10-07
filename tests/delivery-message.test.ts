import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { renderDeliveryMessage, DEFAULT_DELIVERY_MESSAGE, invoiceClosedNotice } = await import('../src/modules/orders/delivery.service.js');

const vars = { name: 'Budi', product: 'Netflix', qty: 2, total: 50000, invoice: 'INV-1' };

test('custom template fills every placeholder, repeatedly', () => {
  const out = renderDeliveryMessage('Hai {name}! {product} x{qty} = {total} ({invoice}). Makasih {name}', vars);
  assert.equal(out, `Hai Budi! Netflix x2 = ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(50000)} (INV-1). Makasih Budi`);
});

test('empty or blank template falls back to the default', () => {
  const expected = renderDeliveryMessage(DEFAULT_DELIVERY_MESSAGE, vars);
  assert.equal(renderDeliveryMessage(null, vars), expected);
  assert.equal(renderDeliveryMessage('   ', vars), expected);
  assert.match(expected, /Netflix x2/);
});

test('output never exceeds Telegram caption limit', () => {
  const out = renderDeliveryMessage('{product}'.repeat(200), { ...vars, product: 'x'.repeat(50) });
  assert.ok(out.length <= 1024);
});

test('closed-invoice notices tell the buyer not to pay', () => {
  assert.match(invoiceClosedNotice('expired', 'INV-9'), /INV-9.*kedaluwarsa[\s\S]*JANGAN/);
  assert.match(invoiceClosedNotice('cancelled', 'INV-9'), /dibatalkan[\s\S]*INV-9[\s\S]*JANGAN/);
});
