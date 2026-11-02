-- Video wallpapers. Additive only: existing rows become kind 'html' and keep working unchanged.
-- Applied after 0001_init.sql (which is already live in production and must never be edited).

-- 'html' = single index.html package (manifest v1). 'video' = single video.mp4 (manifest v2).
ALTER TABLE wallpapers ADD COLUMN kind TEXT NOT NULL DEFAULT 'html' CHECK (kind IN ('html', 'video'));
-- Attribution for videos (NULL for HTML). Shown on the detail page and in the app.
ALTER TABLE wallpapers ADD COLUMN credit TEXT;
ALTER TABLE wallpapers ADD COLUMN license TEXT;
ALTER TABLE wallpapers ADD COLUMN source_url TEXT;
-- 1 while a two-step video upload has its metadata + thumbnail but not yet its verified video bytes.
-- Drafts keep status 'pending' (0001's CHECK has no 'draft'), are hidden from the moderation queue
-- and can't be approved until the PUT /api/uploads/:id/video succeeds.
ALTER TABLE wallpapers ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;

CREATE INDEX wallpapers_kind_new ON wallpapers(status, kind, created_at DESC, id DESC);
CREATE INDEX wallpapers_kind_popular ON wallpapers(status, kind, downloads DESC, id DESC);
