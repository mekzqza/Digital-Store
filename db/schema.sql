-- Runs once on first `docker compose up` (mounted into /docker-entrypoint-initdb.d).
-- A database that already exists never sees later edits to this file: repeat them in migrate() in src/lib.js.

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text,                  -- NULL = Google-only account (no password login until one is set)
  email_verified boolean NOT NULL DEFAULT false, -- proven by the link in the verification email, or by Google sign-in
  role         text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')), -- admins set here only
  disabled      boolean NOT NULL DEFAULT false, -- suspended from the admin Customers page
  failed_logins int NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Registrations waiting for the link in the verification email. The row becomes a users row when the link is
-- clicked, so an address nobody confirmed is never an account and can't keep its real owner from registering.
CREATE TABLE pending_users (
  email         text PRIMARY KEY,
  name          text NOT NULL,
  password_hash text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  sent_at       timestamptz NOT NULL DEFAULT now() -- the last verification email, for the resend limit
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint REFERENCES users,
  action     text NOT NULL,
  detail     text,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Managed from the admin Categories page. The slug is permanent (it is in URLs); name and colour are editable.
CREATE TABLE categories (
  slug  text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,30}$'),
  name  text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1' CHECK (color ~ '^#[0-9a-f]{6}$'), -- card artwork colour
  sort  int NOT NULL DEFAULT 0
);
INSERT INTO categories (slug, name, color, sort) VALUES
  ('template',      'เทมเพลต',       '#6366f1', 1),
  ('source-code',   'ซอร์สโค้ด',      '#8b5cf6', 2),
  ('design-assets', 'ไฟล์กราฟิก',     '#0ea5e9', 3),
  ('online-course', 'คอร์สออนไลน์',   '#14b8a6', 4),
  ('ebook',         'อีบุ๊ก',          '#f97316', 5);

CREATE TABLE products (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              text NOT NULL,
  category          text NOT NULL REFERENCES categories ON UPDATE CASCADE, -- RESTRICT: a category in use can't be deleted
  price             numeric(10,2) NOT NULL CHECK (price > 0),
  compare_at        numeric(10,2),           -- strikethrough price on the product page
  short_description text NOT NULL DEFAULT '', -- one line under the price, max 200 (checked in app)
  description       text NOT NULL DEFAULT '', -- markdown, max 2000 (checked in app)
  seller            text NOT NULL DEFAULT '', -- shown under the product name; empty = the store itself
  tags              text[] NOT NULL DEFAULT '{}',
  license           text NOT NULL DEFAULT 'personal' CHECK (license IN ('personal', 'commercial')),
  cover             text,                    -- filename in UPLOAD_DIR/covers (public); optional, cards fall back to the category colour
  file              text,                    -- filename in UPLOAD_DIR/files (private)
  file_name         text,
  file_size         bigint,
  file_types        text,                    -- display string e.g. 'ZIP'
  version           text,
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'DRAFT' OR file IS NOT NULL)
);

CREATE TABLE cart_items (
  user_id    bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id) -- no qty: 1 per product
);

CREATE SEQUENCE order_seq START 10001;
CREATE TABLE orders (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_no        text NOT NULL UNIQUE DEFAULT 'DS-' || nextval('order_seq'),
  user_id         bigint NOT NULL REFERENCES users,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  total           numeric(10,2) NOT NULL,
  billing_name    text NOT NULL DEFAULT '', -- from the checkout "Billing information" step
  billing_email   text NOT NULL DEFAULT '',
  billing_country text NOT NULL DEFAULT '',
  billing_address text NOT NULL DEFAULT '',
  payment_intent  text UNIQUE,
  failure_code    text,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint NOT NULL REFERENCES orders ON DELETE CASCADE,
  product_id       bigint NOT NULL REFERENCES products, -- RESTRICT: purchased products can't be deleted
  price            numeric(10,2) NOT NULL,
  downloads        int NOT NULL DEFAULT 0,
  last_download_at timestamptz -- library "มีอัปเดต" = product changed after this
);

-- One review per buyer per product; only PAID buyers may write one (checked in app).
CREATE TABLE reviews (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  rating     int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id)
);

-- Admin Settings page: only overrides live here, defaults are in src/lib.js.
CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE INDEX ON products (category);
CREATE INDEX ON orders (user_id);
CREATE INDEX ON order_items (order_id);
CREATE INDEX ON order_items (product_id);
