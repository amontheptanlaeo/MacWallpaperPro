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

- One self-contained `index.html` (inline JS/CSS, assets as data URIs), **≤ 10 MB**
- Thumbnail: PNG/JPEG/WebP, **≤ 2 MB** (1600×1000 recommended)
- Category (required): `cute` · `nature` · `cartoon` · `space` · `scifi` · `abstract`
- Wallpapers read the mouse through standard DOM events (`mousemove`, `mousedown`, `mouseup`, `click`, `pointer*`)
- To receive colours from the app, declare `window.setP = ({c1,c2,c3,speed}) => …` (c* = `[r,g,b]`, 0..1)
- **No network** at runtime: the app blocks every request that is not `file:`/`data:`/`blob:`

Bundled wallpapers live in `Wallpapers/<slug>/` with `index.html`, `thumb.jpg` and
`wallpaper.json` (`{ "id", "title", "description", "tags": [], "category" }`).
`web/scripts/seed.mjs` imports all of them as approved wallpapers by "MacWallpaperPro".

## Security model

| Threat | Defense |
|---|---|
| File altered in transit / server compromised | Server signs a manifest with **Ed25519**; the app verifies it with the embedded public key and checks the file's SHA-256 before installing |
| Wallpaper exfiltrates data / tracks / loads code | App: `WKContentRuleList` blocks every non-local URL, no JS↔native bridge (cursor goes in one way), file access limited to its own folder |
| Uploaded HTML attacking site visitors (XSS) | Uploaded HTML is never rendered on the main origin. Previews come from `/preview/:id` with CSP `sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'` (opaque origin, no network) and are embedded with `<iframe sandbox="allow-scripts">` (no `allow-same-origin`). The same route also works as a top-level page (the app inspector opens it in a WKWebView). The upload page previews a local file through `/preview-sandbox`, an empty shell with the same CSP that receives the HTML by `postMessage` |
| Fake / oversized files | Image magic bytes checked, size limits, `<html` required, UTF-8 required, SHA-256 computed server-side |
| Malicious wallpaper reaching the gallery | Every upload starts as `pending`; a moderator approves it. A scanner flags `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `eval(`, `new Function(`, `importScripts`, `import(`, string timers, `document.cookie`, `window.open`/`top.location`, `<iframe/object/embed/form>`, workers and external URLs for the moderator |
| Account takeover | OAuth 2.0 code flow with `state` (bound to an HttpOnly cookie, compared in constant time) and **PKCE S256**; only verified provider emails are accepted. Session cookie `HttpOnly; Secure; SameSite=Lax`, stored as SHA-256 only, 30 days. `Origin` checked on every POST. Rate limits on sign-in, dev sign-in and upload |
| Dev backdoor in production | `POST /auth/dev` exists only when `ENVIRONMENT=development` (set in `.dev.vars`); otherwise 404 |
| Direct file access | R2 bucket is private; all reads go through the Worker, which serves only approved items (or the owner's/moderator's own pending items) |
| Third-party scripts | Main pages: `script-src 'self'`, no third-party hosts. AdSense hosts are allowed **only** on pages that render a configured ad slot (landing footer, browse, detail). Preview routes never get them |

## HTTP API (Worker, base `https://macwallpaper.elizos.com`)

All JSON. Error = `{ "error": { "code": string, "message": string } }`

### Public (used by the app; no account)
- `GET /api/wallpapers?sort=new|popular&q=&tag=&category=&cursor=` →
  `{ items: WallpaperSummary[], next: string|null }` (24 per page).
  `category` is one of `cute|nature|cartoon|space|scifi|abstract`; omit it (or `all`) for every
  category; an unknown value → 400 `invalid_category`
- `GET /api/categories` → `{ items: { id, count }[] }` (fixed order: cute, nature, cartoon, space, scifi, abstract)
- `GET /api/wallpapers/:id` → `WallpaperDetail`
- `GET /api/wallpapers/:id/manifest` → `SignedManifest` (approved only)
- `GET /api/wallpapers/:id/thumb` → thumbnail image
- `GET /api/wallpapers/:id/download` → bytes of index.html (`application/octet-stream`), header
  `X-Content-SHA256`. **Free for everyone, no auth.** Increments the download count.
- `GET /preview/:id` → wallpaper HTML under the sandbox CSP (approved, or owner/moderator)

### Creator / moderator (web only, session cookie)
- `GET /signin?next=` page; `GET /auth/google|github/start?next=`; `GET /auth/google|github/callback`
- `POST /auth/dev` (development only)
- `POST /api/auth/logout`
- `GET /api/me` → `{ id, email, displayName, avatarUrl, role: "user"|"admin" }`
- `POST /api/wallpapers` (multipart: `title`, `description`, `tags` (comma), `category`, `file` (index.html), `thumb`) → `{ id, status: "pending" }`
- `GET /api/me/wallpapers` → my uploads with `status`, `rejectReason`
- `GET /api/admin/queue` → pending items with scanner findings
- `POST /api/admin/wallpapers/:id/approve` / `reject {reason}`

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
  createdAt: string }
WallpaperDetail = WallpaperSummary & { description: string, version: number, sizeBytes: number,
  sha256: string, owned: true /* legacy: everything is free */, status: "pending"|"approved"|"rejected" }
SignedManifest = { id: string, version: number, sha256: string /* hex */, sizeBytes: number,
  title: string, author: string, signature: string /* base64 Ed25519 */ }
```

### Manifest signature (unchanged)
Signed message (UTF-8, `\n`-separated, no trailing newline):
```
macwallpaperpro-manifest-v1
<id>
<version>
<sha256 hex lowercase>
<sizeBytes>
```
- Public key (raw 32 bytes, base64): `4ACj7B0U1mZeAEoA9oiCy4JPSu3xO/CMuQqvRDYX604=`
- Private key (PKCS#8 DER base64) is in `secrets/signing-private-pkcs8.b64` → Worker secret `SIGNING_KEY_PKCS8`

## Deep links (the app registers the `macwallpaperpro` URL scheme)
- `macwallpaperpro://install?id=<id>` — fired by every "Install" button on the website.
  The page then waits ~1.5 s: if the browser kept focus/visibility (app not installed), it shows a
  "Download MacWallpaperPro (free)" / "I already have it, try again" dialog with a copyable link;
  if the app takes focus later, the dialog closes itself.

## Installing in the app
`~/Library/Application Support/MacWallpaperPro/Wallpapers/<id>/index.html` + `manifest.json`.
Steps: fetch manifest → verify signature → download → check size and SHA-256 → atomic write → show in the app's gallery.

## Website internals (summary; details in `web/README.md`)
- D1 schema `web/migrations/0001_init.sql`: `users`, `identities` (provider links), `sessions`,
  `categories`, `wallpapers` (with `category`), `rate_limits`
- i18n: `web/public/i18n/<code>.json` for en, th, zh-Hans, zh-Hant, ja, ko, es, fr, de, it, pt-BR,
  ru, tr, id, vi, hi, ar (RTL). Language = `?hl=` > `mwp_lang` cookie > `Accept-Language` > en.
  UI is translated; wallpaper titles/descriptions are shown as the creator wrote them.
- Ads: `ADSENSE_CLIENT` + `ADSENSE_SLOT_BROWSE|DETAIL|FOOTER`. Nothing ad-related is emitted when unset.
  Consent banner uses Google Consent Mode v2 with everything denied until the visitor accepts.
