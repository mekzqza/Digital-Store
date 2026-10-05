import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyMail } from '../src/lib.js';

test('verification email: goes to the registrant with the link in both bodies', () => {
  const link = 'https://shop.example.com/verify?token=aB3_-xyz';
  const m = verifyMail('new@gmail.com', link, { store_name: 'Digital Store' });
  assert.equal(m.to, 'new@gmail.com');
  assert.match(m.subject, /Digital Store/);
  assert.ok(m.text.includes(link), m.text);
  assert.ok(m.html.includes(`href="${link}"`), m.html);
});
