import path from 'node:path';
import { Router } from 'express';
import Stripe from 'stripe';
import {
  q, HttpError, EMAIL_RE, UPLOAD_DIR, PUBLIC_SETTINGS, getSettings, optionalAuth, requireAuth,
  signDownload, verifyDownload, page, filters, numericParams, mailer, receiptMail,
} from './lib.js';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_missing');

export const SOLD = `(SELECT count(*)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = p.id AND o.status = 'PAID')`;
const RATING = `(SELECT round(avg(r.rating), 1) FROM reviews r WHERE r.product_id = p.id)`;
// Card fields shared by the storefront, catalog, product page, cart and the admin product list.
export const CARD = `p.id, p.name, p.category, p.price, p.compare_at, p.file_types, p.file_size, p.seller, p.license,
  coalesce(nullif(p.short_description, ''), left(p.description, 120)) AS excerpt,
  '/api/covers/' || p.cover AS cover_url, ${RATING} AS rating,
  (SELECT count(*)::int FROM reviews r WHERE r.product_id = p.id) AS review_count`;
const OWNED = `EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = p.id AND o.user_id = $USER AND o.status = 'PAID')`;
const owned = (param) => OWNED.replace('$USER', param);

// "ยอดนิยม" — the catalog's default sort and the home page's first row.
// TODO(human): decide what "popular" means for this shop. Right now it is simply units sold,
// newest first on ties (so a brand-new shop shows its latest products).
const POPULAR = `${SOLD} DESC, p.created_at DESC`;

export const shop = Router();
numericParams(shop, 'id', 'productId', 'itemId');

// ---------- shop-wide data the web app loads once ----------
shop.get('/categories', async (req, res) => {
  const { rows } = await q(
    `SELECT c.slug, c.name, c.color, count(p.id)::int AS count FROM categories c
     LEFT JOIN products p ON p.category = c.slug AND p.status = 'PUBLISHED'
     GROUP BY c.slug ORDER BY c.sort, c.name`);
  res.json({ items: rows });
});

shop.get('/settings', async (req, res) => {
  const s = await getSettings();
  res.json(Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]])));
});

// ---------- home / catalog / search ----------
// /products?q=&category=&min=&max=&rating=&file=zip|pdf|mp4&license=&sort=popular|newest|rating|price_asc|price_desc&page=&limit=
shop.get('/products', async (req, res) => {
  const { q: term, category, min, max, rating, file, license, sort } = req.query;
  const f = filters(`p.status = 'PUBLISHED'`);
  if (term) f.add(`(p.name ILIKE ? OR p.seller ILIKE ? OR p.short_description ILIKE ? OR array_to_string(p.tags, ' ') ILIKE ?)`, `%${term}%`);
  if (min) f.add('p.price >= ?', Number(min));
  if (max) f.add('p.price <= ?', Number(max));
  if (Number(rating) > 0) f.add(`coalesce(${RATING}, 0) >= ?`, Number(rating));
  if (['zip', 'pdf', 'mp4'].includes(file)) f.add('lower(p.file_name) LIKE ?', `%.${file}`);
  if (['personal', 'commercial'].includes(license)) f.add('p.license = ?', license);
  // facet counts for the filter rail ignore the category filter itself
  const facets = await q(`SELECT p.category, count(*)::int AS n FROM products p WHERE ${f.where.join(' AND ')} GROUP BY 1`, f.params);
  if (category) f.add('p.category = ?', String(category));

  const order = {
    newest: 'p.created_at DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC',
    rating: `${RATING} DESC NULLS LAST, p.created_at DESC`,
  }[sort] ?? POPULAR;
  const size = Math.min(48, Math.max(1, parseInt(req.query.limit) || 12));
  const { limit, offset, page: pg } = page(req, size);
  const { rows } = await q(
    `SELECT ${CARD}, count(*) OVER ()::int AS total FROM products p
     WHERE ${f.where.join(' AND ')} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, f.params);
  res.json({
    items: rows.map(({ total, ...r }) => r),
    total: rows[0]?.total ?? 0, page: pg, pageSize: size,
    categories: Object.fromEntries(facets.rows.map((r) => [r.category, r.n])),
  });
});

// ---------- product detail ----------
shop.get('/products/:id', optionalAuth, async (req, res) => {
  const uid = req.user?.id ?? null;
  const { rows: [p] } = await q(
    `SELECT ${CARD}, p.description, p.short_description, p.tags, p.version, p.updated_at, ${SOLD} AS sold,
       (SELECT o.paid_at FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.user_id = $2 AND o.status = 'PAID' LIMIT 1) AS owned_since,
       EXISTS (SELECT 1 FROM cart_items WHERE user_id = $2 AND product_id = p.id) AS in_cart
     FROM products p WHERE p.id = $1 AND p.status = 'PUBLISHED'`, [req.params.id, uid]);
  if (!p) throw new HttpError(404, 'ไม่พบสินค้านี้');
  const related = await q(
    `SELECT ${CARD} FROM products p WHERE p.category = $1 AND p.id <> $2 AND p.status = 'PUBLISHED'
       AND ($3::bigint IS NULL OR NOT ${owned('$3')}) ORDER BY p.created_at DESC LIMIT 4`,
    [p.category, p.id, uid]);
  const reviews = await q(
    `SELECT r.id, r.rating, r.body, r.created_at, u.name, coalesce(r.user_id = $2, false) AS mine
     FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
    [p.id, uid]);
  res.json({ ...p, related: related.rows, reviews: reviews.rows });
});

// One review per buyer; posting again replaces it. Every review on the page is labelled "ผู้ซื้อจริง",
// so the INSERT only goes through for someone with a PAID order for this product.
shop.post('/products/:id/reviews', requireAuth, async (req, res) => {
  const rating = Number(req.body?.rating);
  const body = String(req.body?.body ?? '').trim();
  const errors = {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'ให้คะแนน 1–5 ดาว';
  if (body.length > 1000) errors.body = 'รีวิวยาวเกิน 1,000 ตัวอักษร';
  if (Object.keys(errors).length) throw new HttpError(422, 'ข้อมูลไม่ถูกต้อง', { errors });
  const { rows } = await q(
    `INSERT INTO reviews (product_id, user_id, rating, body)
     SELECT p.id, $2, $3, $4 FROM products p WHERE p.id = $1 AND ${owned('$2')}
     ON CONFLICT (product_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, created_at = now()
     RETURNING id`, [req.params.id, req.user.id, rating, body]);
  if (!rows[0]) throw new HttpError(403, 'รีวิวได้เฉพาะสินค้าที่ซื้อแล้ว');
  res.status(201).json({ id: rows[0].id });
});

// ---------- cart (server-side for logged-in users; guests keep it client-side and POST on login) ----------
shop.get('/cart', requireAuth, async (req, res) => {
  const removed = await q(
    `DELETE FROM cart_items c USING products p WHERE c.product_id = p.id AND c.user_id = $1 AND p.status <> 'PUBLISHED'
     RETURNING p.id, p.name`, [req.user.id]);
  const { rows } = await q(
    `SELECT ${CARD} FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = $1 ORDER BY c.added_at`,
    [req.user.id]);
  res.json({ items: rows, total: rows.reduce((s, r) => s + r.price, 0), removed: removed.rows });
});

shop.post('/cart', requireAuth, async (req, res) => {
  const ids = [].concat(req.body?.productIds ?? req.body?.productId ?? []).map(Number).filter(Number.isInteger);
  const { rows } = await q(
    `INSERT INTO cart_items (user_id, product_id)
     SELECT $1, p.id FROM products p WHERE p.id = ANY($2) AND p.status = 'PUBLISHED' AND NOT ${owned('$1')}
     ON CONFLICT DO NOTHING RETURNING product_id`, [req.user.id, ids]);
  if (ids.length === 1 && !rows.length) throw new HttpError(409, 'สินค้านี้อยู่ในตะกร้าแล้ว หรือคุณเป็นเจ้าของแล้ว');
  const { rows: [c] } = await q('SELECT count(*)::int AS n FROM cart_items WHERE user_id = $1', [req.user.id]);
  res.status(201).json({ added: rows.map((r) => r.product_id), cartCount: c.n });
});

shop.delete('/cart/:productId', requireAuth, async (req, res) => {
  await q('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.productId]);
  res.status(204).end();
});

// ---------- checkout: body { productIds?, billing? } — productIds omitted = whole cart, given = "ซื้อเลย" ----------
// billing { name, email, country, address } comes from the web checkout step. It is optional so the
// mobile app can keep posting without it; the account's name and email are used instead.
shop.post('/checkout', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const b = req.body?.billing ?? {};
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const billing = [text(b.name, 200) || req.user.name, text(b.email, 200) || req.user.email, text(b.country, 100), text(b.address, 500)];
  if (!EMAIL_RE.test(billing[1])) throw new HttpError(422, 'ข้อมูลไม่ถูกต้อง', { errors: { email: 'รูปแบบอีเมลไม่ถูกต้อง' } });

  let ids = Array.isArray(req.body?.productIds) ? req.body.productIds.map(Number).filter(Number.isInteger) : null;
  if (!ids) ids = (await q('SELECT product_id FROM cart_items WHERE user_id = $1', [uid])).rows.map((r) => r.product_id);

  const { rows: [order] } = await q(
    `WITH p AS (SELECT p.id, p.price FROM products p
                WHERE p.id = ANY($2) AND p.status = 'PUBLISHED' AND NOT ${owned('$1')}),
          o AS (INSERT INTO orders (user_id, total, billing_name, billing_email, billing_country, billing_address)
                SELECT $1, sum(price), $3, $4, $5, $6 FROM p HAVING count(*) > 0
                RETURNING id, order_no, total),
          i AS (INSERT INTO order_items (order_id, product_id, price) SELECT o.id, p.id, p.price FROM o, p)
     SELECT * FROM o`, [uid, ids, ...billing]);
  if (!order) throw new HttpError(400, 'ไม่มีสินค้าที่ชำระเงินได้');

  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(order.total * 100), currency: 'thb',
      receipt_email: billing[1],
      metadata: { order_no: order.order_no },
      automatic_payment_methods: { enabled: true },
    });
    await q('UPDATE orders SET payment_intent = $1 WHERE id = $2', [pi.id, order.id]);
    res.status(201).json({ orderNo: order.order_no, total: order.total, clientSecret: pi.client_secret });
  } catch (e) {
    await q(`UPDATE orders SET status = 'FAILED', failure_code = 'stripe_error' WHERE id = $1`, [order.id]);
    // products priced before the ฿10 rule in admin.js can still reach here
    if (e.code === 'amount_too_small') throw new HttpError(400, 'ยอดชำระขั้นต่ำคือ 10 บาท');
    throw e;
  }
});

// Stripe is the only source of truth for PAID/FAILED. Mounted with a raw body in app.js.
export async function stripeWebhook(req, res) {
  let ev;
  try {
    ev = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('bad signature');
  }
  const pi = ev.data.object;
  if (ev.type === 'payment_intent.succeeded') {
    // status <> 'PAID' also covers FAILED → PAID when the buyer retries the same intent with another card
    const { rows: [o] } = await q(
      `UPDATE orders SET status = 'PAID', paid_at = now(), failure_code = NULL
       WHERE payment_intent = $1 AND status IN ('PENDING', 'FAILED') RETURNING id, user_id`, [pi.id]);
    if (o) {
      await q(
        `DELETE FROM cart_items WHERE user_id = $1 AND product_id IN (SELECT product_id FROM order_items WHERE order_id = $2)`,
        [o.user_id, o.id]);
      // Not awaited: Stripe gets its 200 right away and a mail problem can't turn a paid order into a retried webhook.
      // ponytail: one attempt, a failure is only logged. Add orders.receipt_sent_at + a resend action if a receipt must never be lost.
      sendReceipt(o.id).catch((e) => console.error('receipt email failed:', e.message));
    }
  } else if (ev.type === 'payment_intent.payment_failed') {
    const err = pi.last_payment_error;
    await q(`UPDATE orders SET status = 'FAILED', failure_code = $2 WHERE payment_intent = $1 AND status = 'PENDING'`,
      [pi.id, err?.decline_code ?? err?.code ?? 'payment_failed']);
  }
  res.json({ received: true });
}

// ---------- payment result + order history ----------
const ORDER_ITEMS = `(SELECT coalesce(json_agg(json_build_object(
    'itemId', oi.id, 'productId', p.id, 'name', p.name, 'category', p.category, 'price', oi.price,
    'coverUrl', '/api/covers/' || p.cover, 'fileTypes', p.file_types, 'fileSize', p.file_size,
    'downloads', oi.downloads) ORDER BY oi.id), '[]')
  FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items`;

async function sendReceipt(orderId) {
  if (!mailer) return;
  const { rows: [o] } = await q(
    `SELECT o.order_no, o.total, o.paid_at, o.billing_name, o.billing_email, ${ORDER_ITEMS}
     FROM orders o WHERE o.id = $1`, [orderId]);
  await mailer.sendMail(receiptMail(o, await getSettings()));
}

shop.get('/orders', requireAuth, async (req, res) => {
  const f = filters('o.user_id = $1');
  f.params.push(req.user.id);
  if (req.query.status) f.add('o.status = ?', String(req.query.status));
  if (req.query.year) f.add('extract(year FROM o.created_at) = ?', Number(req.query.year) - 543); // พ.ศ. year, e.g. 2569
  const { rows } = await q(
    `SELECT o.order_no, o.status, o.total, o.failure_code, o.created_at, o.paid_at, o.payment_intent, ${ORDER_ITEMS}
     FROM orders o WHERE ${f.where.join(' AND ')} ORDER BY o.created_at DESC`, f.params);
  res.json({ items: rows });
});

shop.get('/orders/:orderNo', requireAuth, async (req, res) => {
  const { rows: [o] } = await q(
    `SELECT o.order_no, o.status, o.total, o.failure_code, o.created_at, o.paid_at, o.billing_email, ${ORDER_ITEMS}
     FROM orders o WHERE o.order_no = $1 AND o.user_id = $2`, [req.params.orderNo, req.user.id]);
  if (!o) throw new HttpError(404, 'ไม่พบคำสั่งซื้อ');
  res.json(o); // PENDING = "กำลังตรวจสอบการชำระเงิน": poll until webhook flips it
});

// ---------- library + downloads ----------
shop.get('/library', requireAuth, async (req, res) => {
  const s = await getSettings();
  const { rows } = await q(
    `SELECT oi.id AS item_id, p.id AS product_id, p.name, p.category, p.seller, '/api/covers/' || p.cover AS cover_url,
       p.file_types, p.file_size, p.version, o.order_no, o.paid_at,
       oi.downloads, $2::int AS download_limit, o.paid_at + make_interval(days => $3) AS expires_at,
       p.updated_at > coalesce(oi.last_download_at, o.paid_at) AS has_update
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = $1 AND o.status = 'PAID' ORDER BY o.paid_at DESC`,
    [req.user.id, Number(s.download_limit), Number(s.download_days)]);
  res.json({ items: rows });
});

// Spends one download and returns a 5-minute signed URL. Absolute so App Inventor can hand it to Chrome.
shop.post('/library/:itemId/download', requireAuth, async (req, res) => {
  const s = await getSettings();
  const limit = Number(s.download_limit);
  const { rows: [r] } = await q(
    `UPDATE order_items oi SET downloads = downloads + 1, last_download_at = now() FROM orders o
     WHERE oi.id = $1 AND o.id = oi.order_id AND o.user_id = $2 AND o.status = 'PAID'
       AND o.paid_at + make_interval(days => $4) > now() AND oi.downloads < $3
     RETURNING oi.downloads`, [req.params.itemId, req.user.id, limit, Number(s.download_days)]);
  if (!r) throw new HttpError(403, 'ดาวน์โหลดครบจำนวนครั้งแล้ว หรือสิทธิ์หมดอายุ');
  const { exp, sig } = signDownload(req.params.itemId);
  res.json({
    url: `${req.protocol}://${req.get('host')}/api/files/${req.params.itemId}?exp=${exp}&sig=${sig}`,
    downloadsLeft: limit - r.downloads, expiresIn: 300,
  });
});

// No Bearer here: the signature is the auth, because an external browser can't send headers.
shop.get('/files/:itemId', async (req, res) => {
  if (!verifyDownload(req.params.itemId, req.query.exp, req.query.sig)) throw new HttpError(403, 'ลิงก์ดาวน์โหลดหมดอายุ');
  const { rows: [f] } = await q(
    `SELECT p.file, p.file_name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.id = $1`,
    [req.params.itemId]);
  if (!f?.file) throw new HttpError(404, 'ไม่พบไฟล์');
  res.download(path.resolve(UPLOAD_DIR, 'files', f.file), f.file_name);
});
