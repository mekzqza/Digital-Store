import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { HttpError, UPLOAD_DIR, migrate, seedAdmin } from './lib.js';
import { auth } from './auth.js';
import { shop, stripeWebhook } from './shop.js';
import { admin } from './admin.js';

for (const d of ['covers', 'files']) fs.mkdirSync(path.join(UPLOAD_DIR, d), { recursive: true });

const app = express();
app.set('trust proxy', 1); // behind nginx: real client IP for audit log, https for signed URLs

// Stripe signs the raw bytes, so this must come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/covers', express.static(path.join(UPLOAD_DIR, 'covers'), { maxAge: '7d' }));
app.use('/api/auth', auth);
app.use('/api/admin', admin);
app.use('/api', shop);

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') err = new HttpError(413, 'อัปโหลดไม่สำเร็จ — ไฟล์ใหญ่เกิน 500 MB');
  if (!(err instanceof HttpError) && !err.status) console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message, ...err.extra });
});

await migrate();
await seedAdmin();
app.listen(process.env.PORT || 4000, () => console.log(`api on :${process.env.PORT || 4000}`));
