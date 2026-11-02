# MacWallpaperPro — Architecture & Contracts

Three parts:

1. **macOS app** (`Sources/MacWallpaperPro`, Swift/SwiftUI, macOS 15+)
2. **Website** (`web/`, Cloudflare Worker + static assets, D1, R2) at **`https://macwallpaper.elizos.com`**
   - `/` landing page and app download (`/download` → GitHub Releases, R2 fallback)
   - `/community` free community gallery (browse, live preview, one-click install)
   - `/community/upload`, `/community/mine` creator pages; `/community/admin` moderation
   - 17 UI languages, Google AdSense on a few web pages only (never in the app)
3. **The app ↔ web contract** (this document). Both sides must follow it.

Product model: **everything is free**. No payments, coins or purchases. Downloading and installing
never needs an account. Accounts exist only for creators (upload) and moderators, via OAuth
(Google, GitHub). The app has no account or token flow.

---

## Wallpaper package

Two kinds. `wallpaper.json` and the API carry `"kind": "html" | "video"`; a missing kind means `"html"`.

### HTML (`kind: "html"`, the original format)

- One self-contained `index.html` (inline JS/CSS, assets as data URIs), **≤ 10 MB**
- Thumbnail: PNG/JPEG/WebP, **≤ 2 MB** (1600×1000 recommended)
- Category (required): `cute` · `nature` · `cartoon` · `space` · `scifi` · `abstract`
- Wallpapers read the mouse through standard DOM events (`mousemove`, `mousedown`, `mouseup`, `click`, `pointer*`)
- To receive colours from the app, declare `window.setP = ({c1,c2,c3,speed}) => …` (c* = `[r,g,b]`, 0..1)
- **No network** at runtime: the app blocks every request that is not `file:`/`data:`/`blob:`

### Video (`kind: "video"`)

- One `video.mp4`: H.264 or HEVC in an MP4/MOV container, **≤ 60 MB**. The file must start with an
  ISO-BMFF `ftyp` box (checked by the server, the upload page and the seed script)
- Thumbnail and category: same rules as HTML
- Attribution is required: `credit` (≤ 120 chars), `license` (≤ 80 chars, e.g. `"Public domain (NASA)"`,
  `"CC0 1.0"`, `"Own work"`) and an optional `sourceUrl` (http/https). The uploader must tick
  "I own this video or it is public domain/CC0"
- The app plays it **muted and looped** with AVFoundation (`VideoWallpaper`; no WebKit, no colour
  or speed controls). Sound tracks are ignored

### Bundled / seeded wallpapers

- HTML: `Wallpapers/<slug>/` with `index.html`, `thumb.jpg` and
  `wallpaper.json` (`{ "id", "title", "description", "tags": [], "category" }`)
- Video: `Wallpapers-video/<slug>/` with `video.mp4`, `thumb.jpg` and `wallpaper.json`
  (`{ "id", "title", "description", "tags": [], "category", "kind": "video", "credit", "license", "sourceUrl" }`)

`web/scripts/seed.mjs` imports both as approved wallpapers by "MacWallpaperPro" (it computes video
SHA-256s locally in Node).

## Security model

| Threat | Defense |
|---|---|
| File altered in transit / server compromised | Server signs a manifest with **Ed25519**; the app verifies it with the embedded public key and checks the file's SHA-256 before installing |
| Wallpaper exfiltrates data / tracks / loads code | App: `WKContentRuleList` blocks every non-local URL, no JS↔native bridge (cursor goes in one way), file access limited to its own folder |
| Uploaded HTML attacking site visitors (XSS) | Uploaded HTML is never rendered on the main origin. Previews come from `/preview/:id` with CSP `sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'` (opaque origin, no network) and are embedded with `<iframe sandbox="allow-scripts">` (no `allow-same-origin`). The same route also works as a top-level page (the app inspector opens it in a WKWebView). The upload page previews a local file through `/preview-sandbox`, an empty shell with the same CSP that receives the HTML by `postMessage`, and only from its `parent` frame with the site's own origin (opened top-level it does nothing). Both routes append `frame-ancestors 'self'`, so only this site can frame them; top-level loads (the app) are unaffected |
| Fake / oversized files | Image magic bytes checked, size limits, `<html` required, UTF-8 required, SHA-256 computed server-side (HTML). Video: `Content-Length` ≤ 60 MB required up front, the first bytes must be an `ftyp` box (only the first chunk is inspected), and R2 verifies the uploader-declared SHA-256 server-side (the Worker never hashes 60 MB: free plan ≈ 10 ms CPU) |
| Video preview attacking visitors | `/preview/:id` for a video is a fixed, script-free page (full-bleed `<video autoplay loop muted playsinline>`) under CSP `default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; sandbox allow-scripts`. `allow-scripts` is needed only because a bare `sandbox` blocks autoplay ("sandboxed automatic features") and forces native controls; `default-src 'none'` still forbids every script. No `allow-same-origin`, so the page has an opaque origin. For that reason the video download carries no `Cross-Origin-Resource-Policy` header (it would make browsers drop the bytes) |
| Malicious wallpaper reaching the gallery | Every upload starts as `pending`; a moderator approves it. A scanner flags `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `eval(`, `new Function(`, `Function(`, `importScripts`, `import(`, `atob(`, API names built from string pieces (`"fet"+"ch"`), bracket access on `window`/`globalThis`/`self`, `location` changes, `<meta http-equiv=refresh>`, `<base>`, string timers, `document.cookie`, `window.open`/`top.location`, `<iframe/object/embed/form>`, workers and external URLs for the moderator. The scanner is **advisory only** (the queue says so): a clean result is not proof of safety; moderation, the preview CSP and the app's rule list are the controls |
| Account takeover | OAuth 2.0 code flow with `state` (bound to an HttpOnly cookie, compared in constant time) and **PKCE S256**; only verified provider emails are accepted. Session cookie `HttpOnly; Secure; SameSite=Lax`, stored as SHA-256 only, 30 days. `Origin` checked on every POST/PUT/DELETE. Rate limits on sign-in, dev sign-in and upload. Admin rights come only from the `ADMIN_EMAILS` secret and are re-checked on every request, so removing an address demotes immediately. HSTS (`max-age=31536000`) on every response |
| Dev backdoor in production | `POST /auth/dev` exists only when `ENVIRONMENT=development` (set in `.dev.vars`); otherwise 404 |
| Direct file access | R2 bucket is private; all reads go through the Worker, which serves only approved items (or the owner's/moderator's own pending items) |
| Third-party scripts | Main pages: `script-src 'self'`, no third-party hosts. AdSense hosts are allowed **only** on pages that render a configured ad slot (landing footer, browse, detail). Preview routes never get them |

## HTTP API (Worker, base `https://macwallpaper.elizos.com`)

All JSON. Error = `{ "error": { "code": string, "message": string } }`

### Public (used by the app; no account)
- `GET /api/wallpapers?sort=new|popular&q=&tag=&category=&kind=&cursor=` →
  `{ items: WallpaperSummary[], next: string|null }` (24 per page).
  Optional `limit` (whole number, clamped to 1–24; anything else → 400 `invalid_limit`). A malformed
  `cursor` → 400 `invalid_cursor`.
  `category` is one of `cute|nature|cartoon|space|scifi|abstract`; omit it (or `all`) for every
  category; an unknown value → 400 `invalid_category`.
  `kind` is `html|video|all` (optional, default all; unknown → 400 `invalid_kind`).
  **Legacy-app rule:** when `kind` is absent and the `User-Agent` starts with `MacWallpaperPro/`
  (URLSession's default for app builds released before video support, which can verify only v1
  manifests), the list is HTML only. Current app builds always send `kind`. Response has `Vary: User-Agent`
- `GET /api/categories` → `{ items: { id, count }[] }` (fixed order: cute, nature, cartoon, space, scifi, abstract)
- `GET /api/wallpapers/:id` → `WallpaperDetail`
- `GET /api/wallpapers/:id/manifest` → `SignedManifest` (approved only)
- `GET /api/wallpapers/:id/thumb` → thumbnail image
- `GET /api/wallpapers/:id/download` → **free for everyone, no auth**, header `X-Content-SHA256`.
  - HTML: bytes of index.html (`application/octet-stream`, `attachment`), unchanged. Increments the download count
    at most once per IP, wallpaper and UTC day (a salted SHA-256 of the IP is kept for at most two days; no raw IP).
  - Video: `video/mp4`, `Accept-Ranges: bytes`. A single `Range: bytes=a-b | a- | -n` → `206` with
    `Content-Range`; unsatisfiable → `416` with `Content-Range: bytes */<size>`; multi-range → whole file.
    Only requests **without** `Range` (the app's install) increment the download count.
- `GET /preview/:id` → HTML: the wallpaper under the sandbox CSP. Video: the tiny `<video>` page above,
  whose source is `/api/wallpapers/:id/download`. Approved, or owner/moderator. Works top-level in WKWebView

### Creator / moderator (web only, session cookie)
- `GET /signin?next=` page; `GET /auth/google|github/start?next=`; `GET /auth/google|github/callback`
- `POST /auth/dev` (development only)
- `POST /api/auth/logout`
- `GET /api/me` → `{ id, email, displayName, avatarUrl, role: "user"|"admin" }`
- `POST /api/wallpapers` (multipart: `title`, `description`, `tags` (comma), `category`, `file` (index.html), `thumb`) → `{ id, status: "pending" }`
  (`kind` omitted or `html`: unchanged)
- **Video, step 1:** `POST /api/wallpapers` (multipart: `kind=video`, `title`, `description`, `tags`, `category`,
  `credit`, `license`, `sourceUrl`, `rights=on`, `thumb`; no video bytes) → `201 { id, status: "draft", uploadUrl }`.
  The draft is hidden (not public, not in the queue, not in "My uploads", can't be approved: 409 `not_ready`).
  Errors: `invalid_credit`, `invalid_license`, `invalid_source_url`, `rights_required`, plus the usual ones
- **Video, step 2:** `PUT /api/uploads/:id/video` (`uploadUrl`) with the raw bytes, `Content-Length` and
  `X-Content-SHA256: <64 lowercase hex>` (the upload page computes it with `crypto.subtle.digest`).
  The Worker checks auth/ownership/draft state and the headers, peeks the first chunk for `ftyp`, then streams the body
  through a `FixedLengthStream` into `BUCKET.put(key, …, { sha256 })`; R2 verifies the hash. On success the row
  becomes a normal `pending` item with that verified SHA-256 → `201 { id, status: "pending" }`.
  Errors: `411 length_required`, `413 file_too_large` (> 60 MB, before reading the body), `400 invalid_sha256`,
  `400 invalid_video`, `400 hash_mismatch` (R2 rejected the bytes; nothing is stored, the draft can retry),
  `400 upload_incomplete`, `404` (not your draft), `409 already_uploaded`, `429` (20/hour)
- `GET /api/me/wallpapers` → my uploads with `status`, `rejectReason`
- `DELETE /api/me` with JSON `{ "confirm": "DELETE" }` (and a same-site `Origin`) → deletes the account, its
  sessions and identities and every upload (D1 rows and R2 objects) → `{ ok: true, deletedWallpapers }`;
  without the confirmation → 400 `confirm_required`
- `GET /api/admin/queue` → pending items with scanner findings
- `POST /api/admin/wallpapers/:id/approve` / `reject {reason}`
- `GET /api/admin/stats?days=7|30|90` → anonymous aggregates (`totals`, `daily`, `countries`, `referrers`, `utm`,
  `wallpapers`, `github`); other `days` → 400 `invalid_days`. Page: `/community/admin/stats`

Removed: Stripe checkout/webhook/onboarding/earnings, `/api/me/library`, `/app/connect`,
bearer tokens and `macwallpaperpro://auth`. The 402 response no longer exists.

### Site utilities
- `/lang/<code>?next=` sets the language cookie · `/ads.txt` (from `ADSENSE_CLIENT`, 404 when unset)
- `/robots.txt`, `/sitemap.xml`, `/privacy`

### Types
```ts
WallpaperSummary = { id: string, title: string, author: { id: string, name: string },
  priceCents: 0,          // always 0; kept so older app builds keep decoding
  currency: "thb",        // legacy, constant
  thumbUrl: string,       // relative, e.g. "/api/wallpapers/<id>/thumb"
  downloads: number, tags: string[],
  category: "cute"|"nature"|"cartoon"|"space"|"scifi"|"abstract",
  kind: "html"|"video",   // always present
  createdAt: string }
WallpaperDetail = WallpaperSummary & { description: string, version: number, sizeBytes: number,
  sha256: string, owned: true /* legacy: everything is free */, status: "pending"|"approved"|"rejected",
  credit: string|null, license: string|null, sourceUrl: string|null /* videos; null for HTML */ }
// v1 (HTML): exactly this shape, byte-for-byte as before
SignedManifest = { id: string, version: number, sha256: string /* hex */, sizeBytes: number,
  title: string, author: string, signature: string /* base64 Ed25519 */ }
// v2 (video only)
SignedManifestV2 = { format: 2, kind: "video", id, version, sha256, sizeBytes, title, author, signature }
```

### Manifest signatures
**v1** (HTML, unchanged). Signed message (UTF-8, `\n`-separated, no trailing newline):
```
macwallpaperpro-manifest-v1
<id>
<version>
<sha256 hex lowercase>
<sizeBytes>
```
**v2** (video only; the kind is signed, so a manifest can't be replayed as another kind):
```
macwallpaperpro-manifest-v2
<id>
<version>
<kind>
<sha256 hex lowercase>
<sizeBytes>
```
- The same Ed25519 key signs both. A v2 signature never verifies as v1, so app builds that predate
  video reject video manifests with "signature invalid" (they also never see videos in lists; see the legacy-app rule)
- Public key (raw 32 bytes, base64): `4ACj7B0U1mZeAEoA9oiCy4JPSu3xO/CMuQqvRDYX604=`
- Private key (PKCS#8 DER base64) is in `secrets/signing-private-pkcs8.b64` → Worker secret `SIGNING_KEY_PKCS8`

## Deep links (the app registers the `macwallpaperpro` URL scheme)
- `macwallpaperpro://install?id=<id>` — fired by every "Install" button on the website.
  Because any page can open this link, the app never installs silently: it fetches the title, author and
  thumbnail from `GET /api/wallpapers/:id` and asks "Install “…”?" with **Install** / **Cancel** first.
  The in-app Get buttons stay one-click.
  The page then waits ~1.5 s: if the browser kept focus/visibility (app not installed), it shows a
  "Download MacWallpaperPro (free)" / "I already have it, try again" dialog with a copyable link;
  if the app takes focus later, the dialog closes itself.

## Installing in the app
`~/Library/Application Support/MacWallpaperPro/Wallpapers/<id>/` with `manifest.json`, `thumb` and
`index.html` (HTML) or `video.mp4` + `info.json` (video; `{ credit, license, sourceUrl }` from the detail API,
display only, not signed).
Steps: fetch manifest → verify signature (no `format` = v1 ⇒ HTML; `format: 2` = v2 ⇒ the signed `kind`; any other
format is rejected) → check `sizeBytes` (≤ 10 MB HTML, ≤ 60 MB video) → download → check size and SHA-256 →
atomic write into a temp folder, then move → show in the app's gallery. Videos are **streamed to disk while
hashing** (never held in memory) and the download aborts once it exceeds the signed size.
On launch (`scanInstalled`) every folder is re-verified the same way (v1 or v2, then the file's SHA-256);
the video hash is cached per path + size + mtime for later rescans. A modified file is ignored.

## Website internals (summary; details in `web/README.md`)
- D1 schema `web/migrations/0001_init.sql`: `users`, `identities` (provider links), `sessions`,
  `categories`, `wallpapers` (with `category`), `rate_limits`.
  `0002_video.sql` (additive): `wallpapers.kind` (`'html'` default), `credit`, `license`, `source_url`,
  `draft` (1 while a video upload is between step 1 and step 2) and two `(status, kind, …)` indexes.
  Video bytes live in R2 at `wallpapers/<id>/v<version>/video.mp4`
  `0003_stats.sql` (additive): `download_seen` (salted, hashed once-per-day dedupe keys) and
  `stats_daily` (aggregate counters by day, event, wallpaper, country, referrer host, utm_source; no IPs).
  See "Statistics" in `web/README.md`
- i18n: `web/public/i18n/<code>.json` for en, th, zh-Hans, zh-Hant, ja, ko, es, fr, de, it, pt-BR,
  ru, tr, id, vi, hi, ar (RTL). Language = `?hl=` > `mwp_lang` cookie > `Accept-Language` > en.
  UI is translated; wallpaper titles/descriptions are shown as the creator wrote them.
- Ads: `ADSENSE_CLIENT` + `ADSENSE_SLOT_BROWSE|DETAIL|FOOTER`. Nothing ad-related is emitted when unset.
  Consent banner uses Google Consent Mode v2 with everything denied until the visitor accepts.
