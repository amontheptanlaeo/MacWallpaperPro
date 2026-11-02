-- MacWallpaperPro web: initial schema (free-only community, OAuth sign-in for creators).
PRAGMA foreign_keys = ON;

-- Creators and admins. Visitors who only download never get a row here.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- verified email from the OAuth provider
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Linked OAuth identities (one user may sign in with Google and GitHub).
CREATE TABLE identities (
  provider          TEXT NOT NULL CHECK (provider IN ('google', 'github', 'dev')),
  provider_user_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX identities_user ON identities(user_id);

-- Web sessions (cookie). Only the SHA-256 hash of the cookie value is stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Fixed category set. Labels are translated on the website (cat.<id> in public/i18n).
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  sort_order  INTEGER NOT NULL
);
INSERT INTO categories (id, sort_order) VALUES
  ('cute', 1), ('nature', 2), ('cartoon', 3), ('space', 4), ('scifi', 5), ('abstract', 6);

CREATE TABLE wallpapers (
  id             TEXT PRIMARY KEY,                 -- lowercase [a-z0-9-], used as a folder name by the app
  owner_id       TEXT NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '',         -- ",tag1,tag2," for LIKE matching
  category       TEXT NOT NULL REFERENCES categories(id),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  sha256         TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  file_key       TEXT NOT NULL,
  thumb_key      TEXT NOT NULL,
  thumb_type     TEXT NOT NULL,
  downloads      INTEGER NOT NULL DEFAULT 0,
  scan_flags     TEXT NOT NULL DEFAULT '[]',       -- JSON array of scanner findings
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at    TEXT,
  reviewed_by    TEXT
);
CREATE INDEX wallpapers_status_new ON wallpapers(status, created_at DESC, id DESC);
CREATE INDEX wallpapers_status_popular ON wallpapers(status, downloads DESC, id DESC);
CREATE INDEX wallpapers_cat_new ON wallpapers(status, category, created_at DESC, id DESC);
CREATE INDEX wallpapers_cat_popular ON wallpapers(status, category, downloads DESC, id DESC);
CREATE INDEX wallpapers_owner ON wallpapers(owner_id);

-- Fixed-window rate limiting.
CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
