# MacWallpaperPro website

The community site for MacWallpaperPro, a free, open-source (GPL-3.0) live-wallpaper app for macOS.
Everything is free: anyone can browse, preview and install wallpapers without an account. Only
creators (who upload) and moderators sign in, with Google or GitHub. The site pays for itself with
Google AdSense; the app never shows ads.

- Runtime: one Cloudflare Worker (TypeScript) + static assets, D1 (SQLite), R2 (private bucket)
- Pages are rendered by the Worker in 17 languages (`public/i18n/<code>.json`)
- Production (live): <https://macwallpaper.elizos.com> (Workers custom domain on the `elizos.com` zone).
  The root domain `elizos.com` / `www.elizos.com` is routed to the same Worker and forwarded (see below)
- Contracts with the macOS app: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)

## Local development

```sh
cd web
npm install
cp .dev.vars.example .dev.vars        # then paste the signing key into SIGNING_KEY_PKCS8
npm run db:reset                      # wipe .wrangler/state and apply migrations/ (0001_init, 0002_video, 0003_stats)
npm run seed                          # import ../Wallpapers/<slug>/ (HTML) and ../Wallpapers-video/<slug>/ (video)
npm run dev                           # http://localhost:8787
```

With `ENVIRONMENT=development` in `.dev.vars`, `/signin` shows a **Developer sign-in** form that
signs you in as any email (use an address listed in `ADMIN_EMAILS` to get the moderation queue).
It answers 404 in every other environment. Google/GitHub buttons appear only when that provider's
client id **and** secret are set.

To try the ad layout locally with a fake publisher id:

```sh
npx wrangler dev --port 8787 --var ADSENSE_CLIENT:ca-pub-0000000000000000 \
  --var ADSENSE_SLOT_BROWSE:1111111111 --var ADSENSE_SLOT_DETAIL:2222222222 --var ADSENSE_SLOT_FOOTER:3333333333
```

Tests and checks:

```sh
npm test            # i18n key check + vitest (Workers runtime, local D1/R2, mocked OAuth providers)
                    # signs with ../secrets/signing-private-pkcs8.b64 when present, otherwise with an
                    # ephemeral Ed25519 key (CI, forks); MWP_TEST_EPHEMERAL_KEY=1 forces the latter
npm run check:i18n  # every language has every key, same {placeholders}
npm run typecheck
```

### Seeding

`scripts/seed.mjs` imports every folder in `../Wallpapers/` that has `index.html` and
`wallpaper.json` (`{ id, title, description, tags[], category }`; Nebula has built-in metadata).
It also imports every folder in `../Wallpapers-video/` that has `video.mp4` (MP4/MOV with an `ftyp`
box, ≤ 60 MB), `thumb.jpg` (≤ 2 MB) and `wallpaper.json` with `kind: "video"`, `credit`, `license`
and optionally `sourceUrl`. The video SHA-256 is computed in Node; the bytes go to R2 at
`wallpapers/<id>/v1/video.mp4`. Folders that fail a check are skipped with a warning.
`--video-dir=/path` reads videos from another folder (handy for a small local test clip). The seed
needs `migrations/0002_video.sql` applied first.
A missing `thumb.jpg` is rendered with headless Chrome (1600×1000) into
`scripts/seed-assets/thumbs/` (cached; `--rerender` to refresh). It is safe to re-run: rows are
upserted by id (download counts are kept) and files are overwritten.

```sh
npm run seed                 # local (default)
npm run seed:remote          # PRODUCTION D1 + R2; asks you to type "seed production" (or pass --yes)
```

## Environment

| Name | Kind | Purpose |
|---|---|---|
| `SIGNING_KEY_PKCS8` | **secret** | Ed25519 private key (PKCS#8 DER, base64) that signs manifests. Must match the public key in `docs/ARCHITECTURE.md`. |
| `GOOGLE_CLIENT_SECRET` | **secret** | Google OAuth client secret (optional; enables "Continue with Google") |
| `GITHUB_CLIENT_SECRET` | **secret** | GitHub OAuth client secret (optional; enables "Continue with GitHub") |
| `GOOGLE_CLIENT_ID` | var | Google OAuth client id |
| `GITHUB_CLIENT_ID` | var | GitHub OAuth client id (production value is in `wrangler.jsonc`) |
| `ADMIN_EMAILS` | **secret** | Comma-separated verified emails that are moderators. Set it with `npx wrangler secret put ADMIN_EMAILS` (or as an encrypted variable in the dashboard), **never in `wrangler.jsonc`**: that file is public and would publish the moderators' addresses. It is the only source of admin rights: the role is re-checked on every request and sign-in, so removing an address demotes that account immediately (see "Revoking a moderator") |
| `DOWNLOAD_SALT` | **secret** (optional) | Salt for the once-per-day download dedupe hash. Any long random string (`openssl rand -base64 32`). When unset, a salt derived from `SIGNING_KEY_PKCS8` is used. Changing it only resets today's dedupe |
| `ENVIRONMENT` | var | `production` in `wrangler.jsonc`. `development` (only in `.dev.vars`) enables the dev sign-in |
| `SITE_URL` | var | Canonical origin for `<link rel=canonical>`, Open Graph, sitemap, robots |
| `ALLOWED_ORIGINS` | var | Extra Origins allowed on POST (normally empty) |
| `ADSENSE_CLIENT` | var | `ca-pub-XXXXXXXXXXXXXXXX`. Empty = no ads, no ad CSP, no consent banner, `ads.txt` 404 |
| `ADSENSE_SLOT_BROWSE` / `_DETAIL` / `_FOOTER` | var | Numeric ad unit ids. A page only becomes an "ad page" when its slot is set |

Bindings: `DB` (D1 `macwallpaperpro`), `BUCKET` (R2 `macwallpaperpro-files`, private), `ASSETS`.
The D1 `database_id` in `wrangler.jsonc` is the real production id (D1 ids are not secret).

### Revoking a moderator

Remove the address from the `ADMIN_EMAILS` secret (`npx wrangler secret put ADMIN_EMAILS` with the
new list). The next request from that account is treated as a normal user and the cached
`users.role` is rewritten to `user`. To also end their sessions right away:

```sh
npx wrangler d1 execute DB --remote --command "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'former-mod@example.com')"
```

## Root domain forwarding (`elizos.com`)

`elizos.com` and `www.elizos.com` are Workers custom domains of this same Worker (`routes` in
`wrangler.jsonc`). On those hosts the Worker:

- answers `/ads.txt` itself (generated from `ADSENSE_CLIENT`), because AdSense reads it on the root domain;
- serves a tiny verification page at `/` (AdSense site-verification meta + canonical link + instant
  refresh to the site), so AdSense can verify the root domain;
- answers every other path with a `301` to the same path and query on `SITE_URL`. The target is
  built from the site origin with the path set separately, so `//evil.example` or `/%2F%2Fevil.example`
  can never redirect to another host (`test/apex.test.ts`).

## Creating the OAuth apps

The Worker builds the callback URL from the request origin, so register one URL per origin you use.

### GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   (for an organization: Organization settings → Developer settings → OAuth Apps).
2. **Application name**: `MacWallpaperPro`
3. **Homepage URL**: `https://macwallpaper.elizos.com`
4. **Authorization callback URL**: `https://macwallpaper.elizos.com/auth/github/callback`
5. Leave **Enable Device Flow** off. Click **Register application**.
6. Copy the **Client ID** into `GITHUB_CLIENT_ID` (`wrangler.jsonc` → `vars`; client ids are public).
7. **Generate a new client secret**, then: `npx wrangler secret put GITHUB_CLIENT_SECRET`
8. For local testing, create a second OAuth app with callback
   `http://localhost:8787/auth/github/callback` and put its id/secret in `.dev.vars`
   (GitHub allows only one callback URL per OAuth app).

The site asks for `read:user user:email` and only accepts the account's **primary verified** email.
PKCE (S256) and `state` are sent on every request.

### Google

1. <https://console.cloud.google.com/> → create or pick a project.
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience):
   app name `MacWallpaperPro`, support email, app domain `https://macwallpaper.elizos.com`,
   privacy policy `https://macwallpaper.elizos.com/privacy`, authorized domain `elizos.com`.
   User type **External**. Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   (no sensitive scopes, so no verification review is needed). Publish the app to **In production**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized JavaScript origins**: `https://macwallpaper.elizos.com` (and `http://localhost:8787` for dev).
5. **Authorized redirect URIs**:
   - `https://macwallpaper.elizos.com/auth/google/callback`
   - `http://localhost:8787/auth/google/callback` (dev only)
6. Copy the client id into `GOOGLE_CLIENT_ID` (`wrangler.jsonc` → `vars`) and run
   `npx wrangler secret put GOOGLE_CLIENT_SECRET`.

Only Google accounts with `email_verified: true` can sign in. Accounts are linked by verified
email, so the same person can use Google or GitHub.

## Google AdSense

1. Apply at <https://adsense.google.com/> with the site `macwallpaper.elizos.com`. AdSense reviews
   real domains; a `*.workers.dev` hostname is generally not approvable, which is why the custom
   domain matters. The site must be live with content (the seeded wallpapers, privacy page) when you apply.
2. Set `ADSENSE_CLIENT` to your `ca-pub-…` id and deploy. `https://macwallpaper.elizos.com/ads.txt`
   is generated from it (`google.com, pub-…, DIRECT, f08c47fec0942fa0`); AdSense checks this file.
3. Create three **Display** ad units (responsive) and set their ids:
   `ADSENSE_SLOT_BROWSE` (between gallery rows), `ADSENSE_SLOT_DETAIL` (below a wallpaper's
   content), `ADSENSE_SLOT_FOOTER` (landing page, above the footer). Leave Auto ads **off** so ads
   never land on the hero, inside previews or next to Install buttons.
4. EEA/UK/Switzerland: the built-in banner sets Google Consent Mode v2 (everything denied until
   "Accept") and requests non-personalized ads until then. Google requires a **Google-certified
   CMP** (IAB TCF) for personalized ads in those regions. The simplest compliant option is
   AdSense → **Privacy & messaging → European regulations message** (Google's own free CMP),
   which loads from `fundingchoicesmessages.google.com` (already allowed by the ad-page CSP).

## Video wallpapers: deploy order

The video feature added `0002_video.sql` and is backward compatible with installed apps:

```sh
cd web
npx wrangler d1 migrations apply DB --remote   # 1) applies 0002_video.sql (and 0003_stats.sql) — additive only
npx wrangler deploy                            # 2) the new Worker needs the new columns
npm run seed:remote                            # 3) optional: imports ../Wallpapers-video/ (and re-upserts HTML)
```

Run the migration **before** deploying: the old Worker keeps working with the extra columns
(it selects `w.*` and inserts named columns), but the new Worker needs them. Then ship the app
build that understands manifest v2. Older app builds never list videos (see the legacy-app rule in
`docs/ARCHITECTURE.md`) and keep installing HTML wallpapers exactly as before.

## Deploying

The site is live at <https://macwallpaper.elizos.com>. These are the steps for a fresh deployment
(or a fork). Only the owner deploys.

```sh
npx wrangler login
npx wrangler d1 create macwallpaperpro          # fresh setup only: put the database_id into wrangler.jsonc
npx wrangler r2 bucket create macwallpaperpro-files   # keep it private (no public access, no r2.dev)
npx wrangler d1 migrations apply DB --remote      # applies every pending file in migrations/, in order
npx wrangler secret put SIGNING_KEY_PKCS8         # contents of ../secrets/signing-private-pkcs8.b64
npx wrangler secret put ADMIN_EMAILS              # moderators (a secret, never a var in wrangler.jsonc)
npx wrangler secret put DOWNLOAD_SALT             # optional, see Environment
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_SECRET      # if Google sign-in is wanted
# edit wrangler.jsonc vars only for public values: GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID, ADSENSE_*
npx wrangler deploy                               # attaches macwallpaper.elizos.com, elizos.com, www.elizos.com
npm run seed:remote                               # import the bundled wallpapers
```

### Updating production (migrations first)

Always apply new migrations **before** deploying the Worker that needs them. Every migration is
additive, so the old Worker keeps working while the new tables or columns exist.

```sh
cd web
npx wrangler d1 migrations apply DB --remote   # 0002_video.sql, then 0003_stats.sql (whatever is pending)
npx wrangler secret put ADMIN_EMAILS           # once, if ADMIN_EMAILS was ever a plain var: also delete
                                               # that var in the dashboard so only the secret remains
npx wrangler deploy
```

## Statistics (`/community/admin/stats`)

Moderators see anonymous download statistics at `/community/admin/stats` (7, 30 or 90 days; linked
from the moderation queue) and as JSON at `GET /api/admin/stats?days=30`. Both are admin only.

What is recorded (`migrations/0003_stats.sql`, `src/lib/stats.ts`):

| Event | When |
|---|---|
| `app_download` | `GET /download` (still a 302 to GitHub Releases), at most once per visitor per UTC day |
| `wallpaper_install` | a counted wallpaper download (`/api/wallpapers/:id/download`, not `Range` requests), at most once per visitor, wallpaper and day. The same dedupe drives the public `downloads` count |
| `page_view` | the landing page, `/community` and wallpaper detail pages, only for real page loads (`Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate`, not prefetch, HEAD or obvious crawlers). Not deduped |

Each event only increments an aggregate row `(day, event, wallpaper_id, country, ref, utm) → count`
(`INSERT … ON CONFLICT DO UPDATE SET count = count + 1`):

- `country`: `request.cf.country`, `XX` when unknown.
- `ref`: the referrer **host only**, lowercased, without `www.`/`m.`/`mobile.` (`tiktok.com`, `t.co`,
  `reddit.com`); `(direct)` when there is none (the app, typed URLs), `(internal)` for this site.
- `utm`: `utm_source` from the URL, or from a same-site referrer (so `/?utm_source=tiktok` → Download
  is attributed), lowercased, `[a-z0-9_-]`, at most 32 characters.

No IP address, user agent, cookie or per-person row is stored. The once-per-day dedupe keeps
`SHA-256(salt, day, ip, target)` in `download_seen`; rows older than yesterday are pruned. Every
write is a single D1 batch inside `ctx.waitUntil`, so responses never wait for it.

The page also shows GitHub's own release download count (direct downloads that skip `/download`),
fetched from `api.github.com/repos/amontheptanlaeo/MacWallpaperPro/releases` and cached for 10
minutes with the Cache API. The privacy page describes all of this in every language.

## Cloudflare Workers free plan

The free plan allows 100k requests/day and ~10 ms CPU per request. The design keeps CPU tiny:

- **No password hashing.** OAuth replaced PBKDF2 (210k iterations was ~50+ ms of CPU per login).
  A sign-in now costs one SHA-256 (PKCE) plus 2–3 `fetch` subrequests (wall time, not CPU).
- **Sessions** are a random 32-byte cookie; the server stores and looks up its SHA-256 (one hash of
  43 bytes + one indexed D1 read), and only on routes that need an account.
- **Public pages never touch sessions.** The header shows the account menu by calling `/api/me`
  only when a non-secret `mwp_user=1` hint cookie exists.
- **Manifests**: one Ed25519 signature (~0.1 ms); the imported key is cached per isolate.
- **Pages**: string templates (no framework, no HTMLRewriter), 1–4 indexed D1 queries.
- **Statistics**: one SHA-256 of a short string and one D1 batch per counted request, run in
  `ctx.waitUntil` after the response; page views are a single upsert.
- **Static files** (CSS, JS, fonts, i18n JSON) are served by the assets layer without invoking the
  Worker (`run_worker_first` excludes `/assets/*` and `/i18n/*`), so they don't count as Worker requests.
- **Video uploads never touch the CPU budget**: a small multipart POST creates a draft (metadata +
  thumbnail), then `PUT /api/uploads/:id/video` streams the raw bytes straight into R2 through a
  `FixedLengthStream`. The browser computes the SHA-256 (`crypto.subtle.digest`) and sends it in
  `X-Content-SHA256`; R2 verifies it (`put(…, { sha256 })`) and rejects mismatches. The Worker only
  peeks at the first chunk (the MP4 `ftyp` box). Requests up to 100 MB are allowed on the free plan;
  the limit is 60 MB.
- **Video downloads** stream from R2 with `Range` support (206), so `<video>` previews can seek.
  Range requests are not counted as downloads. Hover previews on the site load nothing until hover
  (`preload="none"`) and are browser-cacheable for an hour.
- **Uploads** (HTML) are the heaviest path: multipart parsing, SHA-256 and a **single-pass** combined
  scanner regex over the HTML. Typical wallpapers (20–500 KB) take a few ms. An index.html close
  to the 10 MB limit can exceed the free plan's CPU budget; if creators hit that, upgrade to the
  $5 Workers Paid plan or lower `MAX_HTML_BYTES`.
