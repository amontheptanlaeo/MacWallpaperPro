# Security and open-source readiness review (2026-11-02)

Scope: the published state of `amontheptanlaeo/MacWallpaperPro` at `origin/main` (`cba3e7a`), plus the
full git history of all refs (`main` and `origin/dependabot/npm_and_yarn/web/web-dependencies-eaeced5040`,
8 commits). This review only read files and ran `git` and `grep`. It did not run builds, tests,
scanners or network probes, so runtime behaviour (Cloudflare URL normalization, zone-level headers,
GitHub Releases contents) still needs a manual check where noted.

## Summary

The project is in good shape for a public repo. No real secret was found anywhere in the history:
no private keys, OAuth client secrets, API tokens or `.dev.vars`. The Ed25519 signing key, OAuth
secrets and `ADMIN_EMAILS` are kept out of the repo as Worker secrets or dashboard variables.

The web code is carefully written:
- OAuth uses `state` and PKCE S256, and compares the state in constant time.
- Sessions are stored only as hashes, in an HttpOnly, SameSite=Lax cookie.
- Every POST is checked against the `Origin` header.
- All SQL is parameterized.
- Every HTML template escapes its values, on the server and in the browser JS.
- R2 keys are built by the server, from random ids that match a strict pattern.
- Image types are detected from magic bytes.
- The CSP on HTML pages is strict.

The app side is also sound. It verifies the Ed25519 signature, the SHA-256 and the size before an
atomic install. It checks ids against an allow-list of safe characters. It blocks all network access
for installed wallpapers with a content rule list, and shows a black wallpaper if that list fails to
compile. Every `Process` call uses a fixed path and fixed arguments.

Issues found:
- **1 Medium:** an open redirect on the new root-domain forwarding.
- **Several Low:** admin rights cannot be revoked through config, no HSTS, the preview shell has no
  origin check or `frame-ancestors`, deep links install without confirmation, download counts can be
  inflated, and some numeric input can cause 500 errors.
- **Privacy and hygiene:**
  - The owner's personal email is still in old commits and in every commit's author field.
  - Deletion requests are routed to public GitHub issues.
  - The repo has no CONTRIBUTING, CODE_OF_CONDUCT, templates, CHANGELOG, CODEOWNERS or CI.
  - Some docs are out of date.

## Findings

| # | Severity | Location | Issue | Concrete fix |
|---|---|---|---|---|
| 1 | **Medium** | `web/src/index.ts:97`, `:107` | **Open redirect on the root domain.** `new URL(url.pathname + url.search, site)` treats a path that starts with `//` as protocol-relative. So `https://elizos.com//evil.example/x` builds `https://evil.example/x` and returns a 301 to it (WHATWG URL resolution). The `/` GET page is safe because it only handles the exact path `/`. `web/test/apex.test.ts` only tests normal paths. Confirm with `curl -sI https://elizos.com//example.org`. Cloudflare does not merge duplicate slashes by default. | Build the target from the site origin and set the parts separately: `const t = new URL(site.origin); t.pathname = url.pathname.replace(/^\/+/, "/"); t.search = url.search;`. Then assert `t.origin === site.origin` before redirecting. Add tests for `//evil.example`, `/\evil.example` and `/%2F%2Fevil.example`. |
| 2 | Low | `web/src/lib/auth.ts:46`, `:153-156` | **Removing an email from `ADMIN_EMAILS` does not remove admin rights.** `upsertUser` writes `role = 'admin'` to D1, and `rowToUser` treats `r.role === "admin"` as admin even when the email is no longer listed. | Make `ADMIN_EMAILS` the only source of truth: `role: isAdminEmail(env, r.email) ? "admin" : "user"`. Or demote in `upsertUser` when the email is no longer listed. Also document how to revoke a moderator (`UPDATE users SET role='user'` and `DELETE FROM sessions WHERE user_id=?`). |
| 3 | Low | `web/src/routes/public.ts:194-197`, `:12-20` | **The preview shell accepts HTML from any sender and can be framed by any site.** The `message` listener on `/preview-sandbox` checks neither `e.origin` nor `e.source`, and `PREVIEW_HEADERS` has no `frame-ancestors`. Any site can frame `https://macwallpaper.elizos.com/preview-sandbox` and inject HTML into it. The injected code runs in an opaque origin with `connect-src 'none'`, so the impact is limited to hosting content under the site's URL. When the page is opened top-level, the shell's own `postMessage` to itself happens to use up the `{once:true}` listener, which blocks the window.open variant. That protection is accidental. | In the shell: `if (e.source !== parent \|\| parent === window \|\| e.origin !== "<SITE origin>") return;`. Register the listener without `once` and remove it after the first valid message. Add `frame-ancestors 'self'` to the CSP of `/preview-sandbox` and `/preview/:id`. This does not affect top-level opening by the app's inspector. |
| 4 | Low | `web/src/lib/http.ts:14-17`, `web/public/_headers` | **No `Strict-Transport-Security` header** on Worker responses or static assets. It may be set at the Cloudflare zone level, which the repo cannot show. | Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` to `SECURITY_HEADERS` and `_headers`, or enable HSTS in the Cloudflare SSL/TLS settings for `elizos.com`. Consider adding `Cross-Origin-Opener-Policy: same-origin` on HTML pages. |
| 5 | Low | `Sources/MacWallpaperPro/Community.swift:275-279`, `:159` | **Any web page can install and apply a wallpaper without asking the user.** `macwallpaperpro://install?id=…` calls `install(id:)` with `apply: true`. Only approved, signed wallpapers can be installed, so the harm is a drive-by wallpaper change and an unexpected window. | Show a confirmation sheet with the title and author ("Install and use …?") before installing from a deep link. Or pass `apply: false` for deep links and let the user apply it. |
| 6 | Low | `web/src/routes/public.ts:206-212` | **Download counts can be inflated by anyone.** Each GET to `/api/wallpapers/:id/download` adds one to `downloads`, with no limit or dedupe. The "popular" sort and the landing shelves depend on this number. | Count at most once per IP and wallpaper per day (for example a `downloads_seen(ip_hash, id, day)` row with `INSERT OR IGNORE`), or apply `rateLimit` before counting. |
| 7 | Low | `web/src/routes/public.ts:59`, `:88` | **Some numeric input causes 500 errors instead of 400s.** `limit=1.5` yields `LIMIT 2.5`, and a cursor with a non-numeric first element binds `NaN`. Both fail inside D1. Not exploitable, but noisy. | `const limit = Math.min(PAGE_SIZE, Math.max(1, Math.floor(Number(...)) \|\| PAGE_SIZE));` and reject cursors whose `Number(c[0])` is not finite with 400 `invalid_cursor`. |
| 8 | Low | `web/src/views/pages.ts:489`, `web/public/i18n/*.json` (`privacy.contactBody`) | **Account and data deletion requests are routed to public GitHub issues.** Users must reveal who they are in public. This is also weak for GDPR requests, because the site serves AdSense to EEA users. | Add a private channel, for example a project contact address (not the personal Gmail), a form, or a GitHub private advisory or Discussions category. Better, add a self-service "Delete my account and uploads" action on `/community/mine`. |
| 9 | Low | `web/src/lib/validate.ts:90-107` | **The upload scanner only gives hints and is easy to bypass.** For example `globalThis["fet"+"ch"](…)`, `location.href = "https://…"`, `<meta http-equiv="refresh">` and `<a href>` to external URLs are not flagged. This is documented as advisory, and the real controls are moderation, the preview CSP and the app's rule list. The risk is that moderators trust a "clean" result too much. | Show "no findings does not mean safe" in the admin queue. Add rules for `location` assignments, `http-equiv="refresh"`, `<base`, bracket access on `window`, `globalThis` or `self`, and `atob(`. |
| 10 | Info | `web/src/lib/manifest.ts:15-17`, `Sources/MacWallpaperPro/Community.swift:58-60` | `title` and `author` are not part of the signed manifest message. They are shown in the app ("Installed “%@”") and the gallery. They come over TLS from the official host, so this only matters if the server or the TLS connection is compromised. There is also no protection against downgrading to an older version. | If the format is changed later (v2), sign `title`, `author` and `version`. Have the app refuse a lower `version` than the one installed. |
| 11 | Info | `web/src/lib/auth.ts:99` | The session cookie has no `__Host-` prefix. A subdomain of `elizos.com` could set a cookie with the same name (session fixation or cookie tossing). Low risk while every subdomain is the owner's. | Rename it to `__Host-mwp_session` (it requires `Secure`, `Path=/` and no `Domain`). Keep a dev fallback, because `__Host-` does not work over plain-HTTP localhost. |
| 12 | Info | `web/src/lib/http.ts:26-44` | The ad-page CSP allows `script-src https://*.google https://*.google.com …` and `img-src https:`. That is necessary for AdSense, but it weakens XSS protection on the browse, detail and landing pages, because Google hosts expose JSONP and gadget endpoints. Templates escape correctly today, so this is only defense in depth. | Keep ad pages to the minimum. Consider a nonce-based policy with `'strict-dynamic'` for the AdSense loader instead of host wildcards. |
| 13 | Info | `web/README.md:113-119`, `web/public/assets/js/ads.js` | The custom consent banner is not a Google-certified CMP (IAB TCF). The README already notes this. Google requires a certified CMP to serve ads in the EEA, UK and Switzerland. | Turn on AdSense → Privacy & messaging → European regulations message before you enable personalized ads. |
| 14 | Info | `release.sh:12-17` | The owner's Apple Team ID, App Store Connect key ID and issuer ID are hard-coded. These are identifiers, not secrets (the `.p8` was never committed and `*.p8` is gitignored). But forks cannot use the script without editing it. | Read them from environment variables, for example `TEAM_ID="${TEAM_ID:?set TEAM_ID}"`, and document them in the README. |
| 15 | Info | Git history, all commits | **Personal email exposure.** `amon…@gmail.com` is in `TRADEMARKS.md:22` in commits `efa40a0`, `302cd81`, `888b0fc` and `f007ae2`. It was removed in `ccf596c`, but it is still reachable through `origin/dependabot/…` (`a556165`, based on `f007ae2`). It is also the author and committer email of every commit. | Use the GitHub noreply address from now on (`git config user.email <id>+amontheptanlaeo@users.noreply.github.com`) and turn on "Block command line pushes that expose my email". Rewriting public history (`git filter-repo --mailmap`) is optional and disruptive, since the address is already public. Decide deliberately. At minimum, close or rebase the Dependabot branch. |
| 16 | Info | `web/README.md:132`, `web/wrangler.jsonc:30`, `docs/ARCHITECTURE.md:105` | Stale or misleading docs. The deploy section says "nothing here has been deployed", but the site is live. `database_id` is described as a "Placeholder", but it is the real one (D1 ids are not secret). The README's deploy steps say to put `ADMIN_EMAILS` in `wrangler.jsonc`, which would commit the admin email. | Update the text. Tell maintainers to set `ADMIN_EMAILS` in the dashboard or with `wrangler secret put ADMIN_EMAILS`, never in `wrangler.jsonc`. |
| 17 | Info | `.github/dependabot.yml:10-13` | The `github-actions` ecosystem is configured, but `.github/workflows/` does not exist, so there is no CI. Tests, typecheck and `npm audit` never run on pull requests. | Add a small workflow: `npm ci && npm run typecheck && npm test` in `web/`, plus `swift build` on `macos-15`. Pin actions by commit SHA. |
| 18 | Info | `web/package.json:17-24` | Dev dependencies use caret or minor ranges. `package-lock.json` is committed, all 244 entries resolve to `registry.npmjs.org`, and nothing is a runtime dependency (the Worker bundle has no npm packages). An open Dependabot PR bumps `vitest` to 5.0, a major version. | Fine as is. Use `npm ci`. Review the vitest 5 bump together with `@cloudflare/vitest-pool-workers` compatibility before merging. |

Checked and found sound (no finding):
- **OAuth:**
  - Random 24-byte `state`, compared in constant time.
  - PKCE S256 with a 64-character verifier.
  - The state cookie is HttpOnly, Secure, SameSite=Lax, scoped to `Path=/auth` and lasts 10 minutes.
  - Only verified emails are accepted (Google `email_verified`, GitHub primary and verified email).
  - `next` goes through `safeNext`, which rejects `//`, `/\` and control characters.
- **Dev login:** returns 404 unless `ENVIRONMENT=development`, and production sets `production`.
- **Sessions:** 32 random bytes, stored as SHA-256 only. Logout deletes the row. The `/api/me` hint cookie holds no secret.
- **CSRF:** `checkOrigin` runs on every non-GET route and rejects requests without an `Origin` header.
- **SQL:** every query uses `?` binds. The only interpolations are fixed fragments and a clamped `LIMIT` (see #7).
- **Output escaping:** all server templates use `escapeHtml`. Client `innerHTML` code always escapes with `esc()`. JSON blocks escape `<`.
- **Path traversal:** route ids match `^[a-z0-9][a-z0-9-]{2,39}$`, R2 keys are built by the server, and the app's `isSafeID` blocks `.`, `/` and non-ASCII characters.
- **Uploads:**
  - 10 MB HTML / 2 MB thumbnail limits.
  - HTML must be valid UTF-8 and contain an `<html>` tag.
  - Thumbnail type comes from magic bytes (no SVG).
  - Uploads start as `pending`.
  - 10 uploads per hour per user.
- **Preview:**
  - `/preview/:id` uses `sandbox allow-scripts` (opaque origin, no forms, no top navigation), `connect-src 'none'`, `nosniff` and `CORP: same-origin`.
  - The pages that embed previews use `frame-src 'self'`, so a preview frame cannot navigate to another site.
  - Thumbnails are served with `sandbox`.
- **Admin:** every admin API calls `requireAdmin` on the server. Unpublished items are visible only to their owner or an admin.
- **Errors:** responses contain only stable codes and messages. Stack traces go to logs only.
- **App:**
  - Signature, size and hash are checked again on every scan.
  - Installs write to a temp folder and then swap it into place atomically.
  - The content rule list blocks everything except `file:`, `data:`, `blob:` and `about:`.
  - With no WKUIDelegate, `window.open` does nothing.
  - `Shell.run` only calls `/usr/bin/defaults`, `/usr/bin/killall Finder` and `/usr/bin/pmset` with constant arguments.
  - Accessibility is used only to read and set the focused window's frame and to watch windows close. Global monitors only listen for mouse clicks, and hotkeys use `RegisterEventHotKey`, so there is no keystroke capture.

## Secrets scan result

Method: `git log -p --all` (3.2 MB, 8 commits, both remote branches) was searched for `-----BEGIN`,
`MC4CAQAw` (Ed25519 PKCS#8), `gh[pousr]_`, `github_pat_`, `sk_live`/`sk_test`, `whsec_`, `AIza`,
`AQ.`, `GOCSPX-`, `ya29.`, `AKIA`, `xox*-`, JWTs (`eyJ…`), Cloudflare token variables, long base64
lines, `password`/`secret` assignments, and secret files (`.dev.vars`, `*.p8`, `*.pem`, `*.p12`,
`secrets/`, `*.b64`). Email addresses and phone-number patterns were listed too.

| Result | Detail |
|---|---|
| Private keys | **None.** No `-----BEGIN`, no `MC4C…` PKCS#8. `secrets/` and `*.p8` were never committed. |
| Tokens / API keys | **None real.** Only test fixtures: `whse…` (`whsec_test_secret`, removed Stripe tests, commits `302cd81`/`f007ae2`) and `ya29…` (`ya29.test…`, OAuth test mock). |
| OAuth secrets | **None.** `GOOGLE_CLIENT_SECRET=` and `GITHUB_CLIENT_SECRET=` are empty in `web/.dev.vars.example`. Tests use `google-test-secret` and `github-test-secret`. |
| `.dev.vars` | Never committed. Only `web/.dev.vars.example` (placeholders) exists. |
| Intentionally public | Ed25519 public key `4ACj…`, GitHub OAuth client id `Ov23…`, AdSense publisher id `ca-p…5873…`, D1 `database_id`, Apple Team ID, ASC key id and issuer (`release.sh`). None of these is a credential on its own. |
| Personal data | Owner email `amon…@gmail.com` in `TRADEMARKS.md` in `efa40a0`…`f007ae2` (and the Dependabot branch), and in the author and committer fields of all owner commits (see finding #15). Other addresses are placeholders (`admin@example.com`, `*@example.com`, `team@macwallpaperpro.local/.invalid`). No phone numbers. |

No secret needs to be rotated.

## OSS hygiene checklist

| Item | Status | Notes |
|---|---|---|
| README | **Needs work** | Clear features, build, layout and license. Missing: screenshots or GIFs (only the icon), end-user install steps (download, unzip, move to Applications, Accessibility prompt), prerequisites (Xcode / Swift toolchain version), a "Contributing" section, and a link to the privacy policy. Claims checked: 19 wallpaper folders ("19+" ✓), 17 app and web locales ✓, `.macOS(.v15)` ✓, video, web, lock-screen and auto-quit features exist ✓, bundled wallpapers have no external URLs ✓. The website downloads `releases/latest/download/MacWallpaperPro.zip`, but `release.sh` outputs `MacWallpaperPro-<version>.zip` and its final hint tells you to upload to R2. Say that you rename and upload to GitHub Releases. |
| LICENSE | **Present, good** | Exact GPL-3.0 text (674 lines, 35,149 bytes, SHA-256 `3972dc97…`, which matches the canonical `gpl-3.0.txt`). |
| NOTICE | Present, good | The attribution requirement is a GPL §7(b) term, and the trademark reservation a §7(e) term. Consider citing §7(b) explicitly, as `TRADEMARKS.md` does for §7(e). |
| TRADEMARKS.md | Present, good | English, clear fork steps, no personal email. |
| SECURITY.md | Present, good | Private advisory link, scope, supported versions. Make sure "Private vulnerability reporting" is enabled in the repo settings, or the link 404s. |
| CONTRIBUTING.md | **Missing** | Add: dev setup (app and web), how to submit a wallpaper vs. code, style, tests, translation workflow, DCO or sign-off if wanted, and an "all Markdown in English" rule. |
| CODE_OF_CONDUCT.md | **Missing** | Add Contributor Covenant 2.1 with a non-personal contact. |
| Issue / PR templates | **Missing** | Add `.github/ISSUE_TEMPLATE/{bug,feature,wallpaper-report}.yml`, a `config.yml` that sends security reports to advisories, and `PULL_REQUEST_TEMPLATE.md`. |
| CHANGELOG | **Missing** | Add `CHANGELOG.md` (Keep a Changelog) or use GitHub Releases notes, and link to it. |
| Privacy policy | Present on the site (`/privacy`, covers AdSense, cookies, consent) | Not linked from the README. The contact route for deletion requests is public issues (finding #8). |
| CODEOWNERS | **Missing** | Add `.github/CODEOWNERS` (`* @amontheptanlaeo`) and enable branch protection on `main`. |
| `.gitignore` | Needs work | Covers secrets, `.p8`, `.pem`, `.env*`, `.dev.vars`, build outputs, `node_modules`, `.wrangler`, `.DS_Store`. Add `*.p12`, `*.cer`, `*.mobileprovision`, `*.key`, `.swiftpm/`, `*.xcuserstate`, `xcuserdata/`, `.vscode/`, `.idea/`, `*.log`. The first comment line is in Thai. |
| CI | **Missing** | No `.github/workflows/` (finding #17). |
| Markdown language | **Good** | All 6 Markdown files are English, with no Thai text. Non-Markdown files still have Thai comments: `.gitignore`, `build.sh`, `release.sh` (21 lines), `scripts/make-icon.swift` and all 18 Swift sources. Translate them if contributors are expected to read the code. |
| Broken links | **None found** | All relative links and images in Markdown resolve at `origin/main`. External links point to the site, GitHub, Google and AdSense. |
| Personal info in docs | **Good at HEAD** | No personal email in current files. It remains in history and in commit metadata (finding #15). |
| Stale docs | Needs work | Finding #16. |

## Recommended next steps (ordered)

1. **Fix the root-domain open redirect** (#1) and add regression tests for `//host`, `/\host` and `/%2F%2Fhost`. Check with `curl -sI https://elizos.com//example.org` after deploying.
2. **Make `ADMIN_EMAILS` the only source of admin rights** (#2) and document how to revoke a moderator.
3. **Harden `/preview-sandbox`**: check the message origin and source, and add `frame-ancestors 'self'` to preview responses (#3).
4. **Enable HSTS** (#4), either in code or on the Cloudflare zone.
5. **Give users a private way to request deletion**, and ideally a self-service delete (#8). Enable Google's certified CMP before serving personalized ads in the EEA, UK and Switzerland (#13).
6. **Switch git to the GitHub noreply email**, turn on email-push protection, and close or rebase the stale Dependabot branch (#15).
7. **Add CI** (typecheck, vitest, `npm audit --omit=dev`, `swift build`) with SHA-pinned actions. Add branch protection and CODEOWNERS (#17).
8. **Add the missing community files**: CONTRIBUTING, CODE_OF_CONDUCT, issue and PR templates, CHANGELOG. Add README screenshots, end-user install steps and a privacy link.
9. **App:** confirm before installing from a deep link (#5).
10. **Smaller hardening:** limit download counting (#6), fix the numeric checks (#7), add scanner rules and the "advisory only" note (#9), use the `__Host-` cookie prefix (#11).
11. **Clean up docs and config**: fix the stale deploy notes and the `ADMIN_EMAILS` guidance (#16), move the hard-coded IDs in `release.sh` to environment variables (#14), extend `.gitignore`, and translate the Thai code comments.
12. **When the manifest format is next changed** (v2), sign `title`, `author` and `version`, and refuse downgrades (#10).
