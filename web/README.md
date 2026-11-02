# MacWallpaperPro website

The community site for MacWallpaperPro, a free, open-source (GPL-3.0) live-wallpaper app for macOS.
Everything is free: anyone can browse, preview and install wallpapers without an account. Only
creators (who upload) and moderators sign in, with Google or GitHub. The site pays for itself with
Google AdSense; the app never shows ads.

- Runtime: one Cloudflare Worker (TypeScript) + static assets, D1 (SQLite), R2 (private bucket)
- Pages are rendered by the Worker in 17 languages (`public/i18n/<code>.json`)
- Production: `https://macwallpaper.elizos.com` (Workers custom domain on the `elizos.com` zone)
- Contracts with the macOS app: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)

## Local development

```sh
cd web
npm install
cp .dev.vars.example .dev.vars        # then paste the signing key into SIGNING_KEY_PKCS8
npm run db:reset                      # wipe .wrangler/state and apply migrations/0001_init.sql
npm run seed                          # import every ../Wallpapers/<slug>/ as an approved wallpaper
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
npm run check:i18n  # every language has every key, same {placeholders}
npm run typecheck
```

### Seeding

`scripts/seed.mjs` imports every folder in `../Wallpapers/` that has `index.html` and
`wallpaper.json` (`{ id, title, description, tags[], category }`; Nebula has built-in metadata).
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
| `ADMIN_EMAILS` | var | Comma-separated verified emails that become moderators |
| `ENVIRONMENT` | var | `production` in `wrangler.jsonc`. `development` (only in `.dev.vars`) enables the dev sign-in |
| `SITE_URL` | var | Canonical origin for `<link rel=canonical>`, Open Graph, sitemap, robots |
| `ALLOWED_ORIGINS` | var | Extra Origins allowed on POST (normally empty) |
| `ADSENSE_CLIENT` | var | `ca-pub-XXXXXXXXXXXXXXXX`. Empty = no ads, no ad CSP, no consent banner, `ads.txt` 404 |
| `ADSENSE_SLOT_BROWSE` / `_DETAIL` / `_FOOTER` | var | Numeric ad unit ids. A page only becomes an "ad page" when its slot is set |

Bindings: `DB` (D1 `macwallpaperpro`), `BUCKET` (R2 `macwallpaperpro-files`, private), `ASSETS`.

## Creating the OAuth apps

The Worker builds the callback URL from the request origin, so register one URL per origin you use.

### GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   (for an organization: Organization settings → Developer settings → OAuth Apps).
2. **Application name**: `MacWallpaperPro`
3. **Homepage URL**: `https://macwallpaper.elizos.com`
4. **Authorization callback URL**: `https://macwallpaper.elizos.com/auth/github/callback`
5. Leave **Enable Device Flow** off. Click **Register application**.
6. Copy the **Client ID** into `GITHUB_CLIENT_ID` (`wrangler.jsonc` → `vars`).
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

## Deploying (owner runs this; nothing here has been deployed)

```sh
npx wrangler login
npx wrangler d1 create macwallpaperpro          # paste the database_id into wrangler.jsonc
npx wrangler r2 bucket create macwallpaperpro-files   # keep it private (no public access, no r2.dev)
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put SIGNING_KEY_PKCS8         # contents of ../secrets/signing-private-pkcs8.b64
npx wrangler secret put GITHUB_CLIENT_SECRET      # already uploaded for macwallpaperpro-web
npx wrangler secret put GOOGLE_CLIENT_SECRET      # if Google sign-in is wanted
# edit wrangler.jsonc vars: ADMIN_EMAILS, GOOGLE_CLIENT_ID, ADSENSE_* (when approved)
npx wrangler deploy                               # attaches macwallpaper.elizos.com (custom domain)
npm run seed:remote                               # import the bundled wallpapers
```

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
- **Static files** (CSS, JS, fonts, i18n JSON) are served by the assets layer without invoking the
  Worker (`run_worker_first` excludes `/assets/*` and `/i18n/*`), so they don't count as Worker requests.
- **Uploads** are the heaviest path: multipart parsing, SHA-256 and a **single-pass** combined
  scanner regex over the HTML. Typical wallpapers (20–500 KB) take a few ms. An index.html close
  to the 10 MB limit can exceed the free plan's CPU budget; if creators hit that, upgrade to the
  $5 Workers Paid plan or lower `MAX_HTML_BYTES`.
