-- MacWallpaperPro web: initial schema
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash      TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  stripe_account_id  TEXT,
  payouts_enabled    INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Web sessions (cookie). Only the SHA-256 hash of the cookie value is stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- App bearer tokens (from /app/connect). SHA-256 hash only, 90 days, revocable.
CREATE TABLE api_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL DEFAULT 'MacWallpaperPro',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);

CREATE TABLE wallpapers (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '',        -- normalized ",tag1,tag2," for LIKE matching
  price_cents    INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency       TEXT NOT NULL DEFAULT 'thb',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  sha256         TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  file_key       TEXT NOT NULL,
  thumb_key      TEXT NOT NULL,
  thumb_type     TEXT NOT NULL,
  downloads      INTEGER NOT NULL DEFAULT 0,
  scan_flags     TEXT NOT NULL DEFAULT '[]',      -- JSON array of scanner findings
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at    TEXT,
  reviewed_by    TEXT
);
CREATE INDEX wallpapers_status_new ON wallpapers(status, created_at DESC, id DESC);
CREATE INDEX wallpapers_status_popular ON wallpapers(status, downloads DESC, id DESC);
CREATE INDEX wallpapers_owner ON wallpapers(owner_id);

-- Paid orders (Stripe Checkout, destination charges).
CREATE TABLE purchases (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  wallpaper_id        TEXT NOT NULL REFERENCES wallpapers(id),
  creator_id          TEXT NOT NULL REFERENCES users(id),
  amount_cents        INTEGER NOT NULL,
  fee_cents           INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'thb',
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  stripe_session_id   TEXT UNIQUE,
  stripe_payment_intent TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at             TEXT
);
CREATE INDEX purchases_user ON purchases(user_id, wallpaper_id, status);
CREATE INDEX purchases_creator ON purchases(creator_id, status);
CREATE INDEX purchases_pi ON purchases(stripe_payment_intent);

-- Library: purchased items and free items the user has downloaded.
CREATE TABLE library (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallpaper_id  TEXT NOT NULL REFERENCES wallpapers(id),
  source        TEXT NOT NULL CHECK (source IN ('free', 'purchase')),
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, wallpaper_id)
);

-- Stripe webhook idempotency (by event.id).
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Fixed-window rate limiting.
CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
