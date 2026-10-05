import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptMail } from '../src/lib.js';

test('receipt email: recipient, order number, every item and the total', () => {
  const m = receiptMail({
    order_no: 'DS-10001', total: 1780.5, paid_at: '2026-10-05T07:30:00Z', // 14:30 in Bangkok
    billing_name: 'สมชาย ใจดี', billing_email: 'buyer@gmail.com',
    items: [{ name: 'UI Kit Pro', price: 590 }, { name: 'คอร์ส Next.js', price: 1190.5 }],
  }, { store_name: 'Digital Store', support_email: 'help@example.com' });
  assert.equal(m.to, 'buyer@gmail.com');
  assert.match(m.subject, /DS-10001/);
  for (const s of ['สมชาย ใจดี', 'UI Kit Pro — ฿590.00', 'คอร์ส Next.js — ฿1,190.50', 'รวมทั้งสิ้น: ฿1,780.50', '14:30', 'help@example.com'])
    assert.ok(m.text.includes(s), `missing "${s}" in:\n${m.text}`);
});
