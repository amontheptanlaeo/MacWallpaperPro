-- Download counting and anonymous statistics. Additive only (applied after 0002_video.sql).
-- No IP address, user agent, cookie or per-person row is ever stored.

-- Daily dedupe: a wallpaper install (or app download) counts at most once per visitor per UTC day.
-- `key` is SHA-256(salt, day, ip, target), where the salt is a server-side secret (DOWNLOAD_SALT, or
-- a value derived from SIGNING_KEY_PKCS8 when that is unset), so it can't be reversed to an IP.
-- `hits` = 1 marks the first request of the day. Rows older than yesterday are pruned.
CREATE TABLE download_seen (
  key   TEXT PRIMARY KEY,
  day   TEXT NOT NULL,                 -- UTC date, YYYY-MM-DD (only used for pruning)
  hits  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX download_seen_day ON download_seen(day);

-- Aggregated counters only: one row per (day, event, wallpaper, country, referrer host, utm_source).
CREATE TABLE stats_daily (
  day           TEXT NOT NULL,                       -- UTC date, YYYY-MM-DD
  event         TEXT NOT NULL CHECK (event IN ('app_download', 'wallpaper_install', 'page_view')),
  wallpaper_id  TEXT NOT NULL DEFAULT '',            -- '' = none (kept non-NULL so the upsert key works)
  country       TEXT NOT NULL DEFAULT 'XX',          -- request.cf.country, 'XX' = unknown
  ref           TEXT NOT NULL DEFAULT '(direct)',    -- referrer host only, '(direct)' or '(internal)'
  utm           TEXT NOT NULL DEFAULT '',            -- sanitized utm_source, '' = none
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, wallpaper_id, country, ref, utm)
);
