# Digital Store

ร้านขายสินค้าดิจิทัล (เทมเพลต ซอร์สโค้ด ไฟล์กราฟิก คอร์ส อีบุ๊ก) ชำระเงินผ่าน Stripe (test mode)
ใช้ backend API ตัวเดียวกันทั้งเว็บ, แอปมือถือ (MIT App Inventor) และ desktop

- **Backend:** Node.js 24 + Express 5 + PostgreSQL 17 — `src/`
- **Frontend:** Next.js 15 — `web/` (หน้าตาตามไฟล์ Figma "Digital Store · Foundations 1.0")
- **Deploy:** docker compose บน VM เครื่องเดียว (nginx + certbot, web, api, Postgres) — ตั้งค่าทั้งหมดใน `.env`

## โครงสร้าง

```
db/schema.sql            ตารางทั้งหมด + หมวดหมู่เริ่มต้น (รันอัตโนมัติครั้งแรกที่สร้าง volume ของ Postgres)
src/app.js               Express app, error handler, mount routes
src/lib.js               DB pool, migrate, รหัสผ่าน, session token, signed download URL, อีเมล, ค่าตั้งร้าน, CSV
src/auth.js              สมัคร / ยืนยันอีเมล / ล็อกอิน / Google / ล็อกอินแอดมิน / โปรไฟล์ / logout
src/shop.js              หมวดหมู่, สินค้า, รีวิว, ตะกร้า, checkout, Stripe webhook, คำสั่งซื้อ, คลัง, ดาวน์โหลด
src/admin.js             แดชบอร์ด, สินค้า, หมวดหมู่, คำสั่งซื้อ, ลูกค้า, ไฟล์, การชำระเงิน, นำเข้า/ส่งออก, ตั้งค่า
test/                    node:test
nginx/                   reverse proxy ใน compose: http.conf (port 80), https.conf.template (port 443), cert.sh (ขอ/ต่ออายุ cert)
lab-docker/              เฉพาะ VPS ที่รันร้านอยู่ตอนนี้ ซึ่งใช้ nginx กลางร่วมกับ project อื่น — เครื่องอื่นไม่ต้องสนใจ
web/app/(shop)/          หน้าลูกค้า: หน้าแรก ร้านค้า หมวดหมู่ สินค้า ตะกร้า checkout คำสั่งซื้อ คลัง โปรไฟล์ ยืนยันอีเมล
web/app/login/           เข้าสู่ระบบ / สมัครสมาชิก (เต็มจอ ไม่มีแถบนำทาง)
web/app/admin/           หน้าแอดมิน (desktop ≥1280px เท่านั้น)
web/components/          ui.js (ชิ้นส่วนร่วม), checkout.js, admin.js
web/app/globals.css      design tokens + class ทั้งหมด
```

## ติดตั้งบน server

ต้องมีก่อน: VM ที่ลง Docker (มีคำสั่ง `docker compose`) · โดเมนที่ DNS A record ชี้มาที่ IP ของ VM แล้ว · เปิด port 80 และ 443

```bash
git clone https://github.com/mekzqza/Digital-Store.git
cd Digital-Store
cp .env.example .env        # เติมค่าจริง (ดูตารางด้านล่าง)
docker compose up -d --build
docker compose logs -f nginx          # รอจน certbot ได้ certificate (ครั้งแรกไม่ถึงนาที)
curl https://<DOMAIN>/api/health      # → {"ok":true}
```

ไม่ต้องตั้งค่าอะไรนอกจาก `.env`: nginx ขอและต่ออายุ certificate จาก Let's Encrypt เอง, ตารางใน DB ถูกสร้างตอนเริ่มครั้งแรก,
บัญชีแอดมินถูกสร้างจาก `.env`

ถ้า DNS ยังไม่ชี้มาตอน start เว็บจะยังเข้าไม่ได้ (port 443 ยังไม่เปิด) — nginx ลองขอ certificate ใหม่ทุก 15 นาที
หรือสั่ง `docker compose restart nginx` ให้ลองทันที

| ตัวแปร | ความหมาย |
|---|---|
| `DOMAIN` | โดเมนของร้าน เช่น `shop.example.com` (ไม่ต้องมี `https://`) |
| `ADMIN_EMAIL` `ADMIN_PASSWORD` | บัญชีแอดมิน — ถูกตั้งตามนี้ทุกครั้งที่ API เริ่มทำงาน จะเปลี่ยนรหัส (หรือลืมรหัส) ให้แก้ที่นี่แล้ว `docker compose up -d` · ถ้ารหัสมี `$` หรือ `#` ให้ครอบด้วย `'…'` |
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` จากหน้า webhook ของ Stripe |
| `NEXT_PUBLIC_STRIPE_PK` | `pk_test_…` — ฝังตอน build หน้าเว็บ เปลี่ยนแล้วต้อง `docker compose build web` |
| `GOOGLE_CLIENT_ID` | ไม่บังคับ — OAuth client ID (Web application) สำหรับปุ่ม "ดำเนินการต่อด้วย Google" เว้นว่าง = ไม่แสดงปุ่ม ฝังตอน build เช่นกัน |
| `GMAIL_USER` `GMAIL_APP_PASSWORD` | ไม่บังคับ — บัญชี Gmail ของร้านที่ใช้ส่งลิงก์ยืนยันอีเมลตอนสมัครสมาชิก และใบเสร็จหลังชำระเงินสำเร็จ เว้นว่าง = ไม่ส่งอะไรเลย และสมัครสมาชิกได้ทันทีโดยไม่ยืนยันอีเมล · รหัสต้องเป็น "รหัสผ่านสำหรับแอป" 16 ตัว (เปิด 2-Step Verification แล้วสร้างที่ <https://myaccount.google.com/apppasswords>) ไม่ใช่รหัสเข้า Gmail |
| `POSTGRES_PASSWORD` | ไม่บังคับ — Postgres ไม่เปิด port ออกนอกเครื่องและมีแค่ `api` ที่ต่อถึง จึงใช้ค่าเริ่มต้นได้ ถ้าจะตั้งต้องตั้งก่อน start ครั้งแรก (ตัวอักษร/ตัวเลขเท่านั้น) |
| `APP_SECRET` | ไม่บังคับ — กุญแจเซ็นลิงก์ดาวน์โหลด ไม่ตั้ง = สุ่มใหม่ทุกครั้งที่ API start (ลิงก์อายุ 5 นาทีที่ออกไว้ก่อน restart จะใช้ไม่ได้) |

> **ฐานข้อมูล:** `db/schema.sql` รันเฉพาะตอน volume `pgdata` ถูกสร้างครั้งแรก ตารางและคอลัมน์ที่เพิ่มทีหลัง
> ต้องใส่ซ้ำใน `migrate()` (`src/lib.js`) ด้วย — API รันมันทุกครั้งที่ start ฐานข้อมูลเดิมจึงตามทันเองโดยข้อมูลไม่หาย

### แอป desktop และมือถือ

ทั้งสองตัวถูก build โดยฝังที่อยู่ของร้านไว้ ถ้าใช้โดเมนของตัวเองต้อง build ใหม่: desktop แก้ `SITE` ใน `desktop/main.js`
และลิงก์ใน `desktop/offline.html` แล้ว `npm run dist` · มือถือแก้ URL ในโปรเจกต์ App Inventor

### VPS ของ sukpat.dev (nginx กลาง)

เครื่องนั้น port 80/443 เป็นของ nginx ใน project `lab-docker` ที่ใช้ร่วมกับ project อื่น จึงปิด nginx ของ compose นี้
แล้วต่อ `api`/`web` เข้า network `lab-docker_default` ด้วย alias `ds-api` / `ds-web` แทน — เพิ่มใน `.env` ของเครื่องนั้น:

```bash
COMPOSE_FILE=docker-compose.yml:lab-docker/compose.yml
```

ร้านเปิดที่ `https://digital.product.thiraphatchakon.me` — A record ของชื่อนี้ชี้มาที่ VPS โดยใน Cloudflare ต้องตั้งเป็น
**DNS only**: ใบรับรองฟรีของ Cloudflare ไม่ครอบคลุม subdomain สองชั้น และ proxy จำกัดขนาดอัปโหลดที่ 100 MB

ต้องมี cert ที่ `/etc/letsencrypt/live/digital.product.thiraphatchakon.me/` ก่อน (nginx กลางจะ start ไม่ขึ้นถ้า conf ชี้ cert ที่ไม่มี) แล้ว:

```bash
cp lab-docker/digital.product.thiraphatchakon.me.conf ~/lab-docker/nginx/conf.d/
docker exec lab-docker-nginx-1 nginx -t && docker exec lab-docker-nginx-1 nginx -s reload
```

ที่อยู่เดิม `digital-store.sukpat.dev` ยังใช้ conf เดิมที่ติดตั้งไว้บน VPS — แอป desktop/มือถือที่ build ไว้
และ Stripe webhook ยังชี้ไปที่นั่น ย้ายสองอย่างนี้ก่อนถ้าจะลบ conf เดิม

### Stripe webhook

Stripe Dashboard (Test mode) → Developers → Webhooks → Add endpoint

- URL: `https://<DOMAIN>/api/stripe/webhook`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`

สถานะ PAID / FAILED มาจาก webhook เท่านั้น — ถ้าจ่ายแล้ว order ค้าง PENDING ให้เช็กตรงนี้ก่อน

### ยืนยันอีเมลตอนสมัคร

เมื่อตั้ง `GMAIL_USER` / `GMAIL_APP_PASSWORD` แล้ว การสมัครด้วยอีเมลและรหัสผ่านจะยังไม่สร้างบัญชี: ร้านส่งอีเมลที่มีลิงก์
`https://<DOMAIN>/verify?token=…` (ใช้ได้ 24 ชั่วโมง ใช้ได้ครั้งเดียว) ไปให้ บัญชีถูกสร้างเมื่อกดลิงก์ แล้วจึงเข้าสู่ระบบด้วยรหัสผ่านที่ตั้งไว้
สมัครอีเมลเดิมซ้ำ = ส่งอีเมลใหม่พร้อมลิงก์ใหม่ (ลิงก์เก่าใช้ไม่ได้) · ความถี่ที่ส่งได้กำหนดใน `verifyMailLimit()` (`src/lib.js`)

ลิงก์ใช้ `DOMAIN` จาก `.env` — ถ้าร้านเปิดหลายชื่อ ลิงก์จะพาไปที่ชื่อนี้เสมอ · บัญชีที่มีอยู่ก่อนเปิดใช้ระบบนี้ยังเข้าได้ตามเดิม

### Google sign-in (ไม่บังคับ)

Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application)
เพิ่ม `https://<DOMAIN>` ใน Authorized JavaScript origins แล้วใส่ client ID ใน `GOOGLE_CLIENT_ID`

บัญชีที่ยังไม่เคยยืนยันอีเมล (สมัครไว้ก่อนมีระบบยืนยัน หรือสมัครตอนไม่ได้ตั้ง Gmail) แล้วมาเข้าด้วย Google อีเมลเดียวกัน:
รหัสผ่านเดิมจะถูกล้าง เพราะไม่รู้ว่าใครตั้งรหัสนั้น ตั้งรหัสใหม่ได้ที่หน้าโปรไฟล์ — แอดมินที่ใช้หน้า `/admin/login` ต้องมีรหัสผ่าน ·
บัญชีที่ยืนยันอีเมลแล้ว (กดลิงก์ หรือเคยเข้าด้วย Google) รหัสผ่านอยู่ครบ

### แอดมิน

แอดมินหลักมาจาก `ADMIN_EMAIL` / `ADMIN_PASSWORD` ใน `.env` — เข้าที่ `/admin/login`
(รหัสที่เปลี่ยนในหน้าโปรไฟล์จะถูกทับด้วยค่าใน `.env` เมื่อ API start ครั้งถัดไป)

ไม่มีหน้าสมัครแอดมิน ถ้าจะเพิ่มคนอื่น ให้สมัครเป็นลูกค้าก่อนแล้วเปลี่ยน role ใน DB:

```bash
docker compose exec db psql -U shop -c "UPDATE users SET role='admin' WHERE email='you@example.com';"
```

### ทดสอบการจ่ายเงิน

- สำเร็จ: `4242 4242 4242 4242` · วันหมดอายุอนาคตใดก็ได้ · CVC 3 หลักใดก็ได้
- ถูกปฏิเสธ: `4000 0000 0000 0002`

## พัฒนาในเครื่อง

```bash
npm install && npm test                       # backend unit test
npm run dev                                   # ต้องมี .env + Postgres
cd web && npm install
API_ORIGIN=http://localhost:4000 npm run dev  # proxy /api ไปที่ backend
```

## API (สรุป)

ทุก endpoint อยู่ใต้ `/api` · auth ใช้ `Authorization: Bearer <token>` (ไม่ใช้ cookie เพื่อให้ App Inventor ใช้ได้)
error ตอบเป็น `{ "error": "ข้อความ", ...extra }` · validation ตอบ 422 พร้อม `errors: { field: msg }`

| Method | Path | Auth | หมายเหตุ |
|---|---|---|---|
| POST | `/auth/register` | – | `{name,email,password}` → 202 `{verify:true,email}` และส่งลิงก์ยืนยันไปที่อีเมล (ยังไม่มี token) · ส่งถี่เกิน → 429 · ส่งอีเมลไม่ได้ → 502 · ไม่ได้ตั้ง Gmail → 201 `{token,user}` ทันที |
| POST | `/auth/verify` | – | `{token}` จากลิงก์ในอีเมล → `{email}` (สร้างบัญชี ไม่คืน session) · ลิงก์ผิด หมดอายุ หรือใช้แล้ว → 400 |
| POST | `/auth/login` | – | `{email,password,remember}` · ผิด 5 ครั้งล็อก 15 นาที (423) · บัญชีถูกระงับ หรือยังไม่ได้ยืนยันอีเมล → 403 |
| POST | `/auth/google` | – | `{credential}` (ID token จาก Google Identity Services) · ไม่ได้ตั้ง `GOOGLE_CLIENT_ID` → 501 |
| POST | `/auth/admin/login` | – | รหัสถูกแต่ไม่ใช่แอดมิน → 403 |
| POST | `/auth/logout` · GET `/auth/me` | user | `me` คืน `cartCount` และ `user.has_password` |
| PATCH | `/auth/me` | user | `{name}` และ/หรือ `{currentPassword,newPassword}` (เปลี่ยนรหัส = อุปกรณ์อื่นถูกออกจากระบบ) |
| GET | `/categories` · `/settings` | – | หมวดหมู่ (พร้อมสีและจำนวนสินค้า) · ชื่อร้าน อีเมลช่วยเหลือ ข้อความหน้าแรก |
| GET | `/products?q&category&min&max&rating&file&license&sort&page&limit` | – | sort: `popular` (ค่าเริ่มต้น) `newest` `rating` `price_asc` `price_desc` · file: `zip` `pdf` `mp4` · license: `personal` `commercial` |
| GET | `/products/:id` | optional | มี `rating`, `review_count`, `reviews`, `owned_since`, `in_cart`, `related` |
| POST | `/products/:id/reviews` | user | `{rating 1–5, body}` เฉพาะผู้ที่ซื้อแล้ว (403) · ส่งซ้ำ = แก้รีวิวเดิม |
| GET · POST · DELETE | `/cart` · `/cart/:productId` | user | POST `{productId}` หรือ `{productIds:[]}` |
| POST | `/checkout` | user | `{productIds?, billing?: {name,email,country,address}}` (ไม่ส่ง productIds = ทั้งตะกร้า) → `{orderNo,clientSecret}` |
| GET | `/orders?status&year` · `/orders/:orderNo` | user | year เป็น พ.ศ. · เลขคำสั่งซื้อรูปแบบ `DS-10001` |
| GET | `/library` | user | เฉพาะ order ที่ PAID · `has_update` = สินค้าถูกแก้หลังดาวน์โหลดครั้งล่าสุด |
| POST | `/library/:itemId/download` | user | ใช้สิทธิ์ 1 ครั้ง (จำนวนและอายุสิทธิ์ตั้งในหน้าตั้งค่า) → signed URL อายุ 5 นาที |
| GET | `/files/:itemId?exp&sig` | ลายเซ็น | ลิงก์ที่ได้จากข้อบน |
| POST | `/stripe/webhook` | Stripe | |
| GET | `/admin/stats?days` | admin | ยอดขาย คำสั่งซื้อ ลูกค้า สินค้า กราฟ หมวดหมู่ขายดี |
| GET · POST | `/admin/products` | admin | POST เป็น multipart: fields + `file` (zip/pdf/mp4) + `cover` (jpg/png ไม่บังคับ) |
| PATCH | `/admin/products` | admin | `{ids,status}` |
| GET · PUT · DELETE | `/admin/products/:id` | admin | ลบสินค้าที่มีคนซื้อแล้ว → 409 `{buyers}` |
| GET · POST | `/admin/categories` | admin | POST `{name,slug,color}` |
| PUT · DELETE | `/admin/categories/:slug` | admin | slug แก้ไม่ได้ · ลบหมวดที่ยังมีสินค้า → 409 |
| GET | `/admin/orders?q&status&from&to&page` · `/admin/orders/:orderNo` | admin | |
| POST | `/admin/orders/:orderNo/refund` | admin | เฉพาะ PAID → REFUNDED (ตัดสิทธิ์ดาวน์โหลด) |
| GET | `/admin/customers?q&status&page` | admin | status: `active` `disabled` |
| PATCH | `/admin/customers/:id` | admin | `{disabled}` ระงับ = ออกจากระบบทุกอุปกรณ์และล็อกอินไม่ได้ |
| GET | `/admin/files?q&type&page` · `/admin/payments?q&status&page` | admin | |
| GET | `/admin/export/:type?format=csv\|json` | admin | type: `products` `orders` `customers` `payments` `files` |
| POST | `/admin/import/products?dryRun=1` | admin | body เป็น `text/csv` · คอลัมน์บังคับ `name,category,price` · สร้างเป็น DRAFT ทั้งไฟล์หรือไม่สร้างเลย |
| GET · PUT | `/admin/settings` | admin | `store_name` `support_email` `hero_title` `hero_text` `download_limit` `download_days` |

## แอปมือถือ (App Inventor)

- เก็บ token จาก `/auth/login` แล้วส่ง header `Authorization: Bearer …` ทุก request
- `/auth/register` ตอบ 202 โดยไม่มี token (ต้องกดลิงก์ในอีเมลก่อน): แสดงข้อความให้ไปตรวจอีเมล แล้วค่อยเรียก `/auth/login`
- WebViewer ดาวน์โหลดไฟล์เองไม่ได้: หน้าเว็บเรียก `window.AppInventor.setWebViewString(url)`
  → ในแอปเพิ่ม block `WebViewer.WebViewStringChange` → `ActivityStarter` (Action `android.intent.action.VIEW`, DataUri = ค่าที่ได้) เพื่อเปิดใน Chrome
- `/checkout` ไม่บังคับ `billing` — ไม่ส่งก็ใช้ชื่อและอีเมลของบัญชี

## ยังไม่ได้ทำ

ลืมรหัสผ่าน · โค้ดส่วนลด · ใบเสร็จ PDF · แกลเลอรีภาพตัวอย่าง · ตัวเล่นคอร์ส · rich text editor (ตอนนี้ใช้ textarea + Markdown)
