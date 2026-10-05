import crypto from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import pg from 'pg';

pg.types.setTypeParser(1700, Number); // numeric → JS number (prices fit easily)
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (sql, params) => db.query(sql, params);

export const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// ---- shop settings: defaults here, the admin Settings page stores overrides in the settings table ----
export const SETTING_DEFAULTS = {
  store_name: 'Digital Store',
  support_email: `support@${process.env.DOMAIN || 'example.com'}`,
  hero_title: 'สร้างได้มากขึ้น ค้นหาน้อยลง',
  hero_text: 'สินค้าดิจิทัลคัดสรรสำหรับนักออกแบบ นักพัฒนา และครีเอเตอร์อิสระ',
  download_limit: '5',  // downloads per purchased item
  download_days: '365', // days a purchase stays downloadable
};
export const PUBLIC_SETTINGS = ['store_name', 'support_email', 'hero_title', 'hero_text'];
export async function getSettings() {
  const { rows } = await q('SELECT key, value FROM settings');
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

// ---- passwords (stdlib scrypt, no bcrypt dep) ----
const scrypt = promisify(crypto.scrypt);
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(pw, salt, 64)).toString('hex')}`;
}
export async function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), await scrypt(pw, salt, 64));
}

// ---- first admin: ADMIN_EMAIL / ADMIN_PASSWORD from .env, so a fresh server needs no SQL ----
export async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase(); // login() looks accounts up lowercased
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  // .env is the source of truth and is re-applied on every start, so editing it is also how a lost
  // admin password is reset (there is no "forgot password" page)
  await q(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Admin', $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash,
       disabled = false, failed_logins = 0, locked_until = NULL`,
    [email, await hashPassword(password)]);
}

// ---- sessions: opaque Bearer tokens (App Inventor can't use cookies) ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export async function createSession(userId, days) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions VALUES ($1, $2, now() + make_interval(days => $3))`, [sha(token), userId, days]);
  return token;
}
export const deleteSession = (token) => q('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
// after a password change: every other device is signed out, this one stays
export const deleteOtherSessions = (userId, token) =>
  q('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, sha(token)]);

export const bearer = (req) => req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];

async function loadUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const { rows } = await q(
    `SELECT u.id, u.email, u.name, u.role, u.created_at, u.password_hash IS NOT NULL AS has_password
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`, [sha(token)]);
  return rows[0] || null;
}

export const optionalAuth = async (req, res, next) => { req.user = await loadUser(req); next(); };
export const requireAuth = async (req, res, next) => {
  req.user = await loadUser(req);
  if (!req.user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  next();
};
export const requireAdmin = async (req, res, next) => {
  req.user = await loadUser(req);
  if (!req.user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  if (req.user.role !== 'admin') throw new HttpError(403, 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบหลังร้าน'); // 403, not 401
  next();
};

export const audit = (userId, action, req, detail = null) =>
  q('INSERT INTO audit_log (user_id, action, detail, ip) VALUES ($1, $2, $3, $4)', [userId, action, detail, req.ip]);

// ---- signed download URLs (HMAC, 5 min) ----
// ponytail: no APP_SECRET in .env = a random key per process. A restart only voids links from the last
// 5 minutes; set APP_SECRET if the API ever runs as more than one instance.
const secret = () => (process.env.APP_SECRET ||= crypto.randomBytes(32).toString('hex'));
export function signDownload(itemId, ttlSec = 300, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', secret()).update(`${itemId}.${exp}`).digest('base64url');
  return { exp, sig };
}
export function verifyDownload(itemId, exp, sig, now = Date.now()) {
  if (!(Number(exp) > now / 1000)) return false;
  const good = crypto.createHmac('sha256', secret()).update(`${itemId}.${exp}`).digest('base64url');
  return typeof sig === 'string' && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

// ---- receipt email: sent from the shop's Gmail (SMTP + app password) when an order turns PAID ----
// No GMAIL_USER / GMAIL_APP_PASSWORD in .env = no email is sent.
const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
export const mailer = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, '') }, // Google shows it in groups of four
  })
  : null;

// o: order_no, total, paid_at, billing_name, billing_email, items [{ name, price }] · s: getSettings()
export function receiptMail(o, s) {
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  return {
    from: { name: s.store_name, address: GMAIL_USER }, // replies land in the shop's Gmail inbox
    to: o.billing_email,
    subject: `ใบเสร็จรับเงิน ${o.order_no} — ${s.store_name}`,
    text: [
      `ขอบคุณที่สั่งซื้อจาก ${s.store_name}`,
      '',
      `เลขคำสั่งซื้อ: ${o.order_no}`,
      // the container runs in UTC
      `วันที่ชำระเงิน: ${new Date(o.paid_at).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' })}`,
      `ผู้ซื้อ: ${o.billing_name}`,
      '',
      ...o.items.map((i) => `• ${i.name} — ${baht(i.price)}`),
      `รวมทั้งสิ้น: ${baht(o.total)}`,
      '',
      `ดาวน์โหลดสินค้า: https://${process.env.DOMAIN}/library`,
      `สอบถามเพิ่มเติม: ${s.support_email}`,
    ].join('\n'),
  };
}

// ---- list helpers ----
export const page = (req, size = 20) => {
  const p = Math.max(1, parseInt(req.query.page) || 1);
  return { limit: size, offset: (p - 1) * size, page: p };
};
// WHERE builder: add('p.price >= ?', 100) pushes the value and numbers the placeholder
export const filters = (first = 'true') => {
  const params = [], where = [first];
  return { params, where, add: (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); } };
};
// :id-style params must be numeric, otherwise Postgres raises a cast error (500) instead of a 404
export const numericParams = (router, ...names) => names.forEach((n) =>
  router.param(n, (req, res, next, v) => { if (!/^\d{1,15}$/.test(v)) throw new HttpError(404, 'not found'); next(); }));

// ---- CSV (admin Import / Export) ----
const csvCell = (v) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('|') : String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheets would run it as a formula
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
// BOM first so Excel reads Thai text as UTF-8
export const toCsv = (rows, cols) =>
  '﻿' + [cols, ...rows.map((r) => cols.map((c) => r[c]))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// → array of rows, each an array of cells; quoted cells may contain commas, quotes ("") and newlines
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim())); // drop blank lines
}
